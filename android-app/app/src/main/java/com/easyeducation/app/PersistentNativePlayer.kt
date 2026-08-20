@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.content.Context
import android.os.SystemClock
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-local player session used by the watch page, fullscreen surface and in-app miniplayer.
 * Presentation changes never recreate ExoPlayer. Resolver prefetch is isolated from the active
 * decoder and an in-flight resolve is shared with the watch page instead of duplicated on tap.
 *
 * Long classes keep a deep playback buffer and a fresh provider source waiting in the background.
 * When a signed CDN URL expires, recovery can therefore swap to an already-resolved source at the
 * same position instead of making the student wait for a resolver/network round trip.
 */
object PersistentNativePlayer {
    private const val PLAYER_PREFS = "native_player_positions_v2"
    private const val SPEED_KEY = "youtube_style_speed"
    private const val WARM_SOURCE_TTL_MS = 90_000L
    private const val RECOVERY_WARM_TTL_MS = 20 * 60_000L
    private const val PREWARM_INTERVAL_MS = 10 * 60_000L
    private const val GUARDIAN_TICK_MS = 5_000L
    private const val POSITION_SAVE_INTERVAL_MS = 30_000L
    private const val STALL_RECOVERY_MS = 3_500L

    private data class WarmSource(
        val source: NativeOnlinePlaybackSource,
        val createdAt: Long,
    )

    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val warmSources = ConcurrentHashMap<String, WarmSource>()
    private val inFlightResolves = ConcurrentHashMap<String, Deferred<NativeOnlinePlaybackSource?>>()

    @Volatile private var playerInstance: ExoPlayer? = null
    @Volatile private var activeClassId: String = ""
    @Volatile private var activeSourceUrl: String = ""
    @Volatile private var activeHeight: Int = 0
    @Volatile private var sessionGeneration: Long = 0L
    @Volatile private var recoveryJob: Job? = null
    @Volatile private var guardianJob: Job? = null
    @Volatile private var bufferingSinceMs: Long = 0L
    @Volatile private var lastPositionSaveMs: Long = 0L
    @Volatile private var lastPrewarmMs: Long = 0L

    fun player(context: Context): ExoPlayer {
        playerInstance?.let { return it }
        return synchronized(this) {
            playerInstance ?: run {
                val app = context.applicationContext
                val loadControl = DefaultLoadControl.Builder()
                    .setBufferDurationsMs(
                        60_000,
                        180_000,
                        1_500,
                        2_500,
                    )
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build()
                ExoPlayer.Builder(app)
                    .setLoadControl(loadControl)
                    .build()
                    .also { exo ->
                        val speed = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                            .getFloat(SPEED_KEY, 1f)
                            .coerceIn(0.25f, 4f)
                        exo.setPlaybackSpeed(speed)
                        installLongSessionGuardian(app, exo)
                        playerInstance = exo
                    }
            }
        }
    }

    fun matches(classId: String, sourceUrl: String, requestedHeight: Int? = null): Boolean {
        if (classId.isBlank() || sourceUrl.isBlank()) return false
        if (activeClassId != classId || activeSourceUrl != sourceUrl) return false
        return requestedHeight == null || activeHeight == requestedHeight
    }

    fun currentClassId(): String = activeClassId
    fun currentSourceUrl(): String = activeSourceUrl
    fun currentHeight(): Int = activeHeight
    fun currentPositionMs(): Long = playerInstance?.currentPosition?.coerceAtLeast(0L) ?: 0L

    suspend fun ensureOnline(
        context: Context,
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
        autoPlay: Boolean,
        forceRefresh: Boolean = false,
    ): ExoPlayer = mutex.withLock {
        val app = context.applicationContext
        val exo = player(app)
        val key = warmKey(classId, sourceUrl, requestedHeight)
        val sameLogicalSession = matches(classId, sourceUrl)
        val sameSession = !forceRefresh && sameLogicalSession &&
            activeHeight == requestedHeight && exo.mediaItemCount > 0
        if (sameSession) {
            withContext(Dispatchers.Main.immediate) {
                if (autoPlay) exo.playWhenReady = true
            }
            return@withLock exo
        }

        if (!forceRefresh && activeClassId.isNotBlank() && !sameLogicalSession) {
            sessionGeneration += 1L
            recoveryJob?.cancel()
            recoveryJob = null
            bufferingSinceMs = 0L
            lastPrewarmMs = 0L
        }

        val resumePosition = withContext(Dispatchers.Main.immediate) {
            val current = if (sameLogicalSession && exo.mediaItemCount > 0) {
                exo.currentPosition.coerceAtLeast(0L)
            } else 0L
            saveActivePosition(app, exo)
            current
        }

        if (forceRefresh) {
            inFlightResolves.remove(key)?.cancel()
        }

        val now = System.currentTimeMillis()
        val warmTtl = if (forceRefresh) RECOVERY_WARM_TTL_MS else WARM_SOURCE_TTL_MS
        val warmed = warmSources.remove(key)?.takeIf { now - it.createdAt <= warmTtl }
        val inFlight = if (forceRefresh) {
            null
        } else {
            inFlightResolves[key]?.await()?.also { inFlightResolves.remove(key) }
        }
        val resolved: NativeOnlinePlaybackSource = warmed?.source
            ?: inFlight
            ?: withContext(Dispatchers.IO) {
                NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
            }
        val mediaSource = NativePlaybackSourceResolver.toMediaSource(resolved)

        withContext(Dispatchers.Main.immediate) {
            val savedPosition = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getLong("class:$classId", 0L)
            val targetPosition = maxOf(resumePosition, savedPosition).coerceAtLeast(0L)
            exo.setMediaSource(mediaSource)
            exo.prepare()
            if (targetPosition > 0L) exo.seekTo(targetPosition)
            val speed = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getFloat(SPEED_KEY, 1f)
                .coerceIn(0.25f, 4f)
            exo.setPlaybackSpeed(speed)
            exo.playWhenReady = autoPlay
            if (!sameLogicalSession) sessionGeneration += 1L
            activeClassId = classId
            activeSourceUrl = sourceUrl
            activeHeight = requestedHeight
            bufferingSinceMs = 0L
            lastPositionSaveMs = SystemClock.elapsedRealtime()
            if (lastPrewarmMs <= 0L) lastPrewarmMs = SystemClock.elapsedRealtime()
        }
        pruneWarmSources(now)
        exo
    }

    /** Resolves URLs/metadata only. It never changes the active player's MediaSource. */
    fun prefetch(
        context: Context,
        classId: String,
        sourceUrl: String,
        requestedHeight: Int = 480,
    ) {
        if (classId.isBlank() || sourceUrl.isBlank() || matches(classId, sourceUrl, requestedHeight)) return
        val key = warmKey(classId, sourceUrl, requestedHeight)
        val now = System.currentTimeMillis()
        warmSources[key]?.takeIf { now - it.createdAt <= WARM_SOURCE_TTL_MS }?.let { return }
        startBackgroundResolve(
            context = context.applicationContext,
            classId = classId,
            sourceUrl = sourceUrl,
            requestedHeight = requestedHeight,
            generation = null,
            updatePrewarmClock = false,
        )
    }

    fun play() { playerInstance?.play() }
    fun pause() { playerInstance?.pause() }

    fun savePosition(context: Context) {
        playerInstance?.let { saveActivePosition(context.applicationContext, it) }
    }

    fun stopSession(context: Context, savePosition: Boolean = true) {
        val exo = playerInstance ?: return
        if (savePosition) saveActivePosition(context.applicationContext, exo)
        sessionGeneration += 1L
        recoveryJob?.cancel()
        recoveryJob = null
        bufferingSinceMs = 0L
        lastPrewarmMs = 0L
        exo.stop()
        exo.clearMediaItems()
        activeClassId = ""
        activeSourceUrl = ""
        activeHeight = 0
    }

    fun stopIfOwned(context: Context, exoPlayer: ExoPlayer) {
        if (playerInstance === exoPlayer) stopSession(context, savePosition = true)
        else runCatching { exoPlayer.release() }
    }

    fun resetForSignOut(context: Context) {
        warmSources.clear()
        inFlightResolves.values.forEach { it.cancel() }
        inFlightResolves.clear()
        recoveryJob?.cancel()
        recoveryJob = null
        PlayerChapterQueue.clear()
        stopSession(context, savePosition = true)
    }

    private fun installLongSessionGuardian(context: Context, exo: ExoPlayer) {
        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                if (isRecoverableOnlineError(error)) {
                    scheduleRecovery(context, exo)
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                bufferingSinceMs = if (playbackState == Player.STATE_BUFFERING && exo.playWhenReady) {
                    bufferingSinceMs.takeIf { it > 0L } ?: SystemClock.elapsedRealtime()
                } else 0L
            }
        })

        if (guardianJob?.isActive == true) return
        guardianJob = scope.launch {
            while (true) {
                delay(GUARDIAN_TICK_MS)
                val classId = activeClassId
                val sourceUrl = activeSourceUrl
                val height = activeHeight
                if (classId.isBlank() || sourceUrl.isBlank() || height <= 0) continue
                val now = SystemClock.elapsedRealtime()
                if (now - lastPositionSaveMs >= POSITION_SAVE_INTERVAL_MS) {
                    saveActivePosition(context, exo)
                    lastPositionSaveMs = now
                }
                if (
                    exo.playWhenReady &&
                    now - lastPrewarmMs >= PREWARM_INTERVAL_MS
                ) {
                    lastPrewarmMs = now
                    startBackgroundResolve(
                        context = context,
                        classId = classId,
                        sourceUrl = sourceUrl,
                        requestedHeight = height,
                        generation = sessionGeneration,
                        updatePrewarmClock = true,
                    )
                }
                if (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING) {
                    if (bufferingSinceMs <= 0L) bufferingSinceMs = now
                    if (now - bufferingSinceMs >= STALL_RECOVERY_MS) {
                        scheduleRecovery(context, exo)
                    }
                } else if (exo.playbackState != Player.STATE_BUFFERING) {
                    bufferingSinceMs = 0L
                }
            }
        }
    }

    private fun startBackgroundResolve(
        context: Context,
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
        generation: Long?,
        updatePrewarmClock: Boolean,
    ) {
        val key = warmKey(classId, sourceUrl, requestedHeight)
        if (inFlightResolves[key]?.isActive == true) return
        val deferred = scope.async(Dispatchers.IO) {
            runCatching {
                NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
            }.getOrNull()
        }
        val existing = inFlightResolves.putIfAbsent(key, deferred)
        if (existing != null) {
            deferred.cancel()
            return
        }
        scope.launch {
            val resolved = runCatching { deferred.await() }.getOrNull()
            inFlightResolves.remove(key, deferred)
            val stillRelevant = generation == null || (
                generation == sessionGeneration &&
                    activeClassId == classId &&
                    activeSourceUrl == sourceUrl &&
                    activeHeight == requestedHeight
                )
            if (resolved != null && stillRelevant) {
                warmSources[key] = WarmSource(resolved, System.currentTimeMillis())
                pruneWarmSources(System.currentTimeMillis())
                if (updatePrewarmClock) lastPrewarmMs = SystemClock.elapsedRealtime()
            }
        }
    }

    private fun scheduleRecovery(context: Context, exo: ExoPlayer) {
        if (recoveryJob?.isActive == true) return
        val classId = activeClassId
        val sourceUrl = activeSourceUrl
        val height = activeHeight
        if (classId.isBlank() || sourceUrl.isBlank() || height <= 0) return
        val generation = sessionGeneration
        val shouldResume = exo.playWhenReady

        val job = scope.launch {
            var attempt = 0
            while (
                generation == sessionGeneration &&
                activeClassId == classId &&
                activeSourceUrl == sourceUrl &&
                activeHeight == height
            ) {
                if (attempt > 0) delay(recoveryBackoffMs(attempt))
                saveActivePosition(context, exo)
                val recovered = runCatching {
                    ensureOnline(
                        context = context,
                        classId = classId,
                        sourceUrl = sourceUrl,
                        requestedHeight = height,
                        autoPlay = shouldResume,
                        forceRefresh = true,
                    )
                }.isSuccess
                if (recovered) {
                    bufferingSinceMs = 0L
                    lastPrewarmMs = SystemClock.elapsedRealtime()
                    return@launch
                }
                attempt += 1
            }
        }
        recoveryJob = job
        job.invokeOnCompletion {
            if (recoveryJob === job) recoveryJob = null
        }
    }

    private fun recoveryBackoffMs(attempt: Int): Long = when (attempt) {
        0 -> 0L
        1 -> 500L
        2 -> 1_000L
        3 -> 2_000L
        4 -> 5_000L
        5 -> 10_000L
        else -> 20_000L
    }

    private fun isRecoverableOnlineError(error: PlaybackException): Boolean {
        if (error.errorCode in 2000..2999) return true
        var current: Throwable? = error
        repeat(8) {
            val value = current?.message.orEmpty()
            if (
                value.contains("401", true) ||
                value.contains("403", true) ||
                value.contains("404", true) ||
                value.contains("410", true) ||
                value.contains("416", true) ||
                value.contains("429", true) ||
                value.contains("500", true) ||
                value.contains("502", true) ||
                value.contains("503", true) ||
                value.contains("504", true) ||
                value.contains("forbidden", true) ||
                value.contains("expired", true) ||
                value.contains("timeout", true) ||
                value.contains("connection", true) ||
                value.contains("network", true) ||
                value.contains("unable to resolve host", true)
            ) return true
            current = current?.cause
            if (current == null) return false
        }
        return false
    }

    private fun saveActivePosition(context: Context, exo: ExoPlayer) {
        val classId = activeClassId
        val position = exo.currentPosition
        if (classId.isBlank() || position <= 0L) return
        context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit().putLong("class:$classId", position).apply()
    }

    private fun warmKey(classId: String, sourceUrl: String, height: Int): String =
        "$classId|$height|$sourceUrl"

    private fun pruneWarmSources(now: Long) {
        warmSources.entries.removeIf { now - it.value.createdAt > RECOVERY_WARM_TTL_MS }
        if (warmSources.size <= 6) return
        warmSources.entries
            .sortedBy { it.value.createdAt }
            .take(warmSources.size - 6)
            .forEach { warmSources.remove(it.key, it.value) }
    }
}
