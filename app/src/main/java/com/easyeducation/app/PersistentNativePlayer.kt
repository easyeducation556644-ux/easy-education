@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.content.Context
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/** Process-local player session shared by watch page, fullscreen surface and miniplayer. */
object PersistentNativePlayer {
    private const val PLAYER_PREFS = "native_player_positions_v2"
    private const val SPEED_KEY = "youtube_style_speed"
    private const val TOPIC_SEEK_PREFIX = "topic_seek:"
    private const val WARM_SOURCE_TTL_MS = 90_000L

    private data class WarmSource(val source: NativeOnlinePlaybackSource, val createdAt: Long)

    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val warmSources = ConcurrentHashMap<String, WarmSource>()
    private val inFlightResolves = ConcurrentHashMap<String, Deferred<NativeOnlinePlaybackSource?>>()
    private val pendingTopicSeeks = ConcurrentHashMap<String, Long>()

    @Volatile private var playerInstance: ExoPlayer? = null
    @Volatile private var activeClassId: String = ""
    @Volatile private var activeSourceUrl: String = ""
    @Volatile private var activeHeight: Int = 0

    fun player(context: Context): ExoPlayer {
        playerInstance?.let { return it }
        return synchronized(this) {
            playerInstance ?: ExoPlayer.Builder(context.applicationContext).build().also { exo ->
                val speed = context.applicationContext.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                    .getFloat(SPEED_KEY, 1f).coerceIn(0.25f, 4f)
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

    /**
     * A topic jump is not a resume position. Keep it in a separate one-shot slot so navigation or
     * saveActivePosition cannot overwrite the requested timestamp before the destination class opens.
     */
    fun seekToTopic(context: Context, classId: String, positionMs: Long) {
        if (classId.isBlank()) return
        val app = context.applicationContext
        val target = positionMs.coerceAtLeast(0L)
        pendingTopicSeeks[classId] = target
        app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit().putLong("$TOPIC_SEEK_PREFIX$classId", target).apply()

        val exo = playerInstance
        if (exo != null && activeClassId == classId && exo.mediaItemCount > 0) {
            exo.seekTo(target)
            app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .edit().putLong("class:$classId", target).remove("$TOPIC_SEEK_PREFIX$classId").apply()
            pendingTopicSeeks.remove(classId)
        }
    }

    private fun consumeTopicSeek(context: Context, classId: String): Long? {
        pendingTopicSeeks.remove(classId)?.let { value ->
            context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .edit().remove("$TOPIC_SEEK_PREFIX$classId").apply()
            return value
        }
        val prefs = context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
        val key = "$TOPIC_SEEK_PREFIX$classId"
        if (!prefs.contains(key)) return null
        val value = prefs.getLong(key, 0L).coerceAtLeast(0L)
        prefs.edit().remove(key).apply()
        return value
    }

    fun applySavedPosition(context: Context, classId: String) {
        val exo = playerInstance ?: return
        if (classId.isBlank() || activeClassId != classId) return
        val saved = context.applicationContext.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getLong("class:$classId", 0L)
        if (saved >= 0L && kotlin.math.abs(exo.currentPosition - saved) > 350L) exo.seekTo(saved)
    }

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
        val pendingTopic = consumeTopicSeek(app, classId)
        val key = warmKey(classId, sourceUrl, requestedHeight)
        val sameSession = !forceRefresh && matches(classId, sourceUrl, requestedHeight) && exo.mediaItemCount > 0
        if (sameSession) {
            withContext(Dispatchers.Main.immediate) {
                if (pendingTopic != null) {
                    exo.seekTo(pendingTopic)
                    app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                        .edit().putLong("class:$classId", pendingTopic).apply()
                } else {
                    applySavedPosition(app, classId)
                }
                if (autoPlay) exo.playWhenReady = true
            }
            return@withLock exo
        }

        withContext(Dispatchers.Main.immediate) { saveActivePosition(app, exo) }

        if (forceRefresh) {
            warmSources.remove(key)
            inFlightResolves.remove(key)?.cancel()
        }

        val now = System.currentTimeMillis()
        val warmed = if (forceRefresh) null else warmSources.remove(key)?.takeIf { now - it.createdAt <= WARM_SOURCE_TTL_MS }
        val inFlight = if (forceRefresh) null else inFlightResolves[key]?.await()?.also { inFlightResolves.remove(key) }
        val resolved: NativeOnlinePlaybackSource = warmed?.source ?: inFlight ?: withContext(Dispatchers.IO) {
            NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
        }
        val mediaSource = NativePlaybackSourceResolver.toMediaSource(resolved)

        withContext(Dispatchers.Main.immediate) {
            exo.setMediaSource(mediaSource)
            val resume = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE).getLong("class:$classId", 0L)
            val target = pendingTopic ?: resume
            exo.prepare()
            if (pendingTopic != null || target > 0L) exo.seekTo(target.coerceAtLeast(0L))
            if (pendingTopic != null) app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .edit().putLong("class:$classId", pendingTopic).apply()
            val speed = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getFloat(SPEED_KEY, 1f).coerceIn(0.25f, 4f)
            exo.setPlaybackSpeed(speed)
            exo.playWhenReady = autoPlay
            activeClassId = classId
            activeSourceUrl = sourceUrl
            activeHeight = requestedHeight
        }
        pruneWarmSources(now)
        exo
    }

    fun prefetch(context: Context, classId: String, sourceUrl: String, requestedHeight: Int = 480) {
        if (classId.isBlank() || sourceUrl.isBlank() || matches(classId, sourceUrl, requestedHeight)) return
        val key = warmKey(classId, sourceUrl, requestedHeight)
        val now = System.currentTimeMillis()
        warmSources[key]?.takeIf { now - it.createdAt <= WARM_SOURCE_TTL_MS }?.let { return }
        if (inFlightResolves[key]?.isActive == true) return
        val app = context.applicationContext
        val deferred = scope.async(Dispatchers.IO) {
            runCatching { NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight) }.getOrNull()
        }
        val existing = inFlightResolves.putIfAbsent(key, deferred)
        if (existing != null) { deferred.cancel(); return }
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
    fun savePosition(context: Context) { playerInstance?.let { saveActivePosition(context.applicationContext, it) } }

    fun stopSession(context: Context, savePosition: Boolean = true) {
        val exo = playerInstance ?: return
        if (savePosition) saveActivePosition(context.applicationContext, exo)
        exo.stop(); exo.clearMediaItems()
        activeClassId = ""; activeSourceUrl = ""; activeHeight = 0
    }

    fun stopIfOwned(context: Context, exoPlayer: ExoPlayer) {
        if (playerInstance === exoPlayer) stopSession(context, savePosition = true) else runCatching { exoPlayer.release() }
    }

    fun resetForSignOut(context: Context) {
        warmSources.clear()
        inFlightResolves.values.forEach { it.cancel() }
        inFlightResolves.clear()
        pendingTopicSeeks.clear()
        PlayerChapterQueue.clear()
        stopSession(context, savePosition = true)
    }

    private fun saveActivePosition(context: Context, exo: ExoPlayer) {
        val classId = activeClassId
        val position = exo.currentPosition
        if (classId.isBlank() || position <= 0L) return
        context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit().putLong("class:$classId", position).apply()
    }

    private fun warmKey(classId: String, sourceUrl: String, height: Int): String = "$classId|$height|$sourceUrl"

    private fun pruneWarmSources(now: Long) {
        warmSources.entries.removeIf { now - it.value.createdAt > WARM_SOURCE_TTL_MS }
        if (warmSources.size <= 4) return
        warmSources.entries.sortedBy { it.value.createdAt }.take(warmSources.size - 4)
            .forEach { warmSources.remove(it.key, it.value) }
    }
}
