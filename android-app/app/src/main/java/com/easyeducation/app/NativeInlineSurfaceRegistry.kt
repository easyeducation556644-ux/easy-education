package com.easyeducation.app

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import java.lang.ref.WeakReference

/** Weakly remembers the currently composed inline player surface. It owns no player state; it only
 * restores the existing video surface after PiP/overlay handoff without prepare() or URL resolve. */
@UnstableApi
object NativeInlineSurfaceRegistry {
    private var hostRef = WeakReference<YoutubeWatchGestureHost>(null)
    private var classId: String = ""

    @Synchronized
    fun register(host: YoutubeWatchGestureHost, ownerClassId: String) {
        hostRef = WeakReference(host)
        classId = ownerClassId
    }

    @Synchronized
    fun unregister(host: YoutubeWatchGestureHost?) {
        if (host == null || hostRef.get() === host) {
            hostRef.clear()
            classId = ""
        }
    }

    @Synchronized
    fun restore(player: ExoPlayer): Boolean {
        val host = hostRef.get() ?: return false
        if (classId.isBlank() || classId != PersistentNativePlayer.currentClassId()) return false
        host.playerSurface.bindPlayer(player)
        host.resetPagePresentation()
        return true
    }
}