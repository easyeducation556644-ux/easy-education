package com.easyeducation.app

import android.graphics.Rect
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import java.lang.ref.WeakReference

/**
 * Remembers the live inline host and the latest inline-mode binding callback. Fullscreen/PiP/mini
 * return paths reparent the one shared YoutubeStylePlayerView back into this host instead of
 * creating/binding a second visual player.
 */
@UnstableApi
object NativeInlineSurfaceRegistry {
    private var hostRef = WeakReference<YoutubeWatchGestureHost>(null)
    private var classId: String = ""
    private var configureSurface: ((YoutubeStylePlayerView) -> Unit)? = null

    @Synchronized
    fun register(
        host: YoutubeWatchGestureHost,
        ownerClassId: String,
        configure: ((YoutubeStylePlayerView) -> Unit)? = null,
    ) {
        hostRef = WeakReference(host)
        classId = ownerClassId
        if (configure != null) configureSurface = configure
    }

    @Synchronized
    fun unregister(host: YoutubeWatchGestureHost?) {
        if (host == null || hostRef.get() === host) {
            hostRef.clear()
            classId = ""
            configureSurface = null
        }
    }

    @Synchronized
    fun canRestore(): Boolean =
        hostRef.get() != null && classId.isNotBlank() && classId == PersistentNativePlayer.currentClassId()

    @Synchronized
    fun targetBounds(ownerClassId: String? = null): Rect? {
        if (!ownerClassId.isNullOrBlank() && classId != ownerClassId) return null
        return hostRef.get()?.globalBounds()
    }

    @Synchronized
    fun restore(player: ExoPlayer): Boolean {
        val host = hostRef.get() ?: return false
        if (classId.isBlank() || classId != PersistentNativePlayer.currentClassId()) return false
        // During mini -> full expansion the target host exists underneath the live overlay. Using
        // obtain() here used to reset/reparent the shared view as soon as the host was constructed,
        // leaving the still-animating top shell as a one-frame black rectangle. Keep the current
        // view in that shell until the morph is complete, then perform the one intentional move.
        val shared = NativeSharedPlayerSurface.current() ?: NativeSharedPlayerSurface.obtain(host.context)
        val surface = host.attachSharedSurface(shared)
        surface.bindPlayer(player)
        configureSurface?.invoke(surface)
        host.resetPagePresentation()
        return true
    }
}
