@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.content.Context
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-local player session used by the watch page, fullscreen surface and in-app miniplayer.
 * Presentation changes never recreate ExoPlayer. A separate short-lived resolver cache can warm the
 * next class without mutating the currently playing media session.
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

    @Volatile private var playerInstance: ExoPlayer? = null
    @Volatile private var activeClassId: String = ""
    @Volatile private var activeSourceUrl: String = ""
    @Volatile private var activeHeight: Int = 0

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

        withContext(Dispatchers.Main.immediate) {
            saveActivePosition(app, exo)
        }

        val key = warmKey(classId, sourceUrl, requestedHeight)
        val now = System.currentTimeMillis()
        val warmed = warmSources.remove(key)?.takeIf { now - it.createdAt <= WARM_SOURCE_TTL_MS }
        val resolved = warmed?.source ?: withContext(Dispatchers.IO) {
            NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
        }
        val mediaSource = NativePlaybackSourceResolver.toMediaSource(resolved)

        withContext(Dispatchers.Main.immediate) {
            exo.setMediaSource(mediaSource)
            val saved = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getLong("class:$classId", 0L)
            exo.prepare()
            if (saved > 0L) exo.seekTo(saved)
            val speed = app.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                .getFloat(SPEED_KEY, 1f)
                .coerceIn(0.25f, 4f)
            exo.setPlaybackSpeed(speed)
            exo.playWhenReady = autoPlay
            activeClassId = classId
            activeSourceUrl = sourceUrl
            activeHeight = requestedHeight
        }
        pruneWarmSources(now)
        exo
    }

    /**
     * Resolves only metadata/direct stream URLs. It never calls setMediaSource or touches the active
     * decoder, so a playing class cannot be interrupted by watch-next preloading.
     */
    fun prefetch(
        context: Context,
        classId: String,
        sourceUrl: String,
        requestedHeight: Int = 480,
    ) {
        if (classId.isBlank() || sourceUrl.isBlank() || matches(classId, sourceUrl, requestedHeight)) return
        val key = warmKey(classId, sourceUrl, requestedHeight)
        val existing = warmSources[key]
        val now = System.currentTimeMillis()
        if (existing != null && now - existing.createdAt <= WARM_SOURCE_TTL_MS) return
        val app = context.applicationContext
        scope.launch {
            val resolved = withContext(Dispatchers.IO) {
                runCatching {
                    NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
                }.getOrNull()
            }
            if (resolved != null) {
                warmSources[key] = WarmSource(resolved, System.currentTimeMillis())
                pruneWarmSources(System.currentTimeMillis())
            }
        }
    }

    fun play() {
        playerInstance?.play()
    }

    fun pause() {
        playerInstance?.pause()
    }

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
    }

    fun stopIfOwned(context: Context, exoPlayer: ExoPlayer) {
        if (playerInstance === exoPlayer) stopSession(context, savePosition = true)
        else runCatching { exoPlayer.release() }
    }

    fun resetForSignOut(context: Context) {
        warmSources.clear()
        stopSession(context, savePosition = true)
    }

    private fun saveActivePosition(context: Context, exo: ExoPlayer) {
        val classId = activeClassId
        val position = exo.currentPosition
        if (classId.isBlank() || position <= 0L) return
        context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong("class:$classId", position)
            .apply()
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
