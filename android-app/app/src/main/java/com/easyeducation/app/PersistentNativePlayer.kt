@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-local player session used by the watch page, fullscreen surface and in-app miniplayer.
 * Presentation changes never recreate ExoPlayer. Resolver prefetch is isolated from the active
 * decoder and an in-flight resolve is shared with the watch page instead of duplicated on tap.
 */
object PersistentNativePlayer {
    private const val PLAYER_PREFS = "native_player_positions_v2"
    private const val SPEED_KEY = "youtube_style_speed"
    private const val WARM_SOURCE_TTL_MS = 90_000L

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
    @Volatile private var activeTitle: String = ""
    @Volatile private var miniRequestPending: Boolean = false

    fun player(context: Context): ExoPlayer {
        playerInstance?.let { return it }
        return synchronized(this) {
            playerInstance ?: ExoPlayer.Builder(context.applicationContext).build().also { exo ->
                val speed = context.applicationContext
                    .getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                    .getFloat(SPEED_KEY, 1f)
                    .coerceIn(0.25f, 4f)
                exo.setPlaybackSpeed(speed)
                playerInstance = exo
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
    fun currentTitle(): String = activeTitle

    suspend fun ensureOnline(
        context: Context,
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
        autoPlay: Boolean,
    ): ExoPlayer = mutex.withLock {
        val app = context.applicationContext
        val exo = player(app)
        val sameSession = matches(classId, sourceUrl, requestedHeight) && exo.mediaItemCount > 0
        if (sameSession) {
            withContext(Dispatchers.Main.immediate) {
                if (autoPlay) exo.playWhenReady = true
            }
            return@withLock exo
        }

        withContext(Dispatchers.Main.immediate) { saveActivePosition(app, exo) }

        val key = warmKey(classId, sourceUrl, requestedHeight)
        val now = System.currentTimeMillis()
        val warmed = warmSources.remove(key)?.takeIf { now - it.createdAt <= WARM_SOURCE_TTL_MS }
        val resolved = warmed?.source
            ?: inFlightResolves[key]?.await()?.also { inFlightResolves.remove(key) }
            ?: withContext(Dispatchers.IO) {
                NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
            }
        val mediaSource = NativePlaybackSourceResolver.toMediaSource(resolved)

        withContext(Dispatchers.Main.immediate) {
            exo.setMediaSource(mediaSource)
            val saved = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getLong("class:$classId", 0L)
            exo.prepare()
            if (saved > 0L) exo.seekTo(saved)
            restoreSpeed(app, exo)
            exo.playWhenReady = autoPlay
            activeClassId = classId
            activeSourceUrl = sourceUrl
            activeHeight = requestedHeight
            activeTitle = ""
            miniRequestPending = false
        }
        pruneWarmSources(now)
        exo
    }

    /**
     * Offline playback uses the same process-local ExoPlayer as online playback. This lets the
     * encrypted SecureChunkDataSource survive fullscreen -> mini-player -> PiP presentation changes
     * without decrypting to a temporary file or creating a second decoder.
     */
    suspend fun ensureOffline(
        context: Context,
        task: SecureDownloadTask,
        autoPlay: Boolean,
    ): ExoPlayer = mutex.withLock {
        val app = context.applicationContext
        val exo = player(app)
        val secureUrl = "secure://easy-education/${task.id}"
        val requestedHeight = task.height.takeIf { it > 0 } ?: 480
        val sameSession = matches(task.classId, secureUrl, requestedHeight) && exo.mediaItemCount > 0
        if (sameSession) {
            withContext(Dispatchers.Main.immediate) {
                activeTitle = task.title
                if (autoPlay) exo.playWhenReady = true
            }
            return@withLock exo
        }

        withContext(Dispatchers.Main.immediate) { saveActivePosition(app, exo) }
        val mediaSource = ProgressiveMediaSource.Factory(
            SecureChunkDataSource.Factory(app, task.id, task.userId),
        ).createMediaSource(MediaItem.fromUri(Uri.parse(secureUrl)))

        withContext(Dispatchers.Main.immediate) {
            exo.setMediaSource(mediaSource)
            val saved = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getLong("class:${task.classId}", 0L)
            exo.prepare()
            if (saved > 0L) exo.seekTo(saved)
            restoreSpeed(app, exo)
            exo.playWhenReady = autoPlay
            activeClassId = task.classId
            activeSourceUrl = secureUrl
            activeHeight = requestedHeight
            activeTitle = task.title
            miniRequestPending = false
        }
        exo
    }

    fun requestMiniAfterActivity(title: String = "") {
        if (title.isNotBlank()) activeTitle = title
        miniRequestPending = activeClassId.isNotBlank() && activeSourceUrl.isNotBlank()
    }

    fun consumeMiniRequest(): Boolean = synchronized(this) {
        val pending = miniRequestPending
        miniRequestPending = false
        pending
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
        scope.async {
            val resolved = runCatching { deferred.await() }.getOrNull()
            inFlightResolves.remove(key, deferred)
            if (resolved != null) {
                warmSources[key] = WarmSource(resolved, System.currentTimeMillis())
                pruneWarmSources(System.currentTimeMillis())
            }
            Unit
        }
    }

    fun play() { playerInstance?.play() }
    fun pause() { playerInstance?.pause() }

    fun savePosition(context: Context) {
        playerInstance?.let { saveActivePosition(context.applicationContext, it) }
    }

    fun stopSession(context: Context, savePosition: Boolean = true) {
        val exo = playerInstance ?: return
        if (savePosition) saveActivePosition(context.applicationContext, exo)
        exo.stop()
        exo.clearMediaItems()
        activeClassId = ""
        activeSourceUrl = ""
        activeHeight = 0
        activeTitle = ""
        miniRequestPending = false
    }

    fun stopIfOwned(context: Context, exoPlayer: ExoPlayer) {
        if (playerInstance === exoPlayer) stopSession(context, savePosition = true)
        else runCatching { exoPlayer.release() }
    }

    fun resetForSignOut(context: Context) {
        warmSources.clear()
        inFlightResolves.values.forEach { it.cancel() }
        inFlightResolves.clear()
        PlayerChapterQueue.clear()
        stopSession(context, savePosition = true)
    }

    private fun restoreSpeed(context: Context, exo: ExoPlayer) {
        val speed = context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getFloat(SPEED_KEY, 1f)
            .coerceIn(0.25f, 4f)
        exo.setPlaybackSpeed(speed)
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
        warmSources.entries.removeIf { now - it.value.createdAt > WARM_SOURCE_TTL_MS }
        if (warmSources.size <= 4) return
        warmSources.entries
            .sortedBy { it.value.createdAt }
            .take(warmSources.size - 4)
            .forEach { warmSources.remove(it.key, it.value) }
    }
}
