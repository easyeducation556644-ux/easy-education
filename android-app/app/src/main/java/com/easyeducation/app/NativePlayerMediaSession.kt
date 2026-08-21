package com.easyeducation.app

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession

/** Keeps one MediaSession around the one process-local ExoPlayer so Android PiP/system controls
 * operate on the same playback state instead of creating another player. */
@UnstableApi
object NativePlayerMediaSession {
    private var session: MediaSession? = null

    @Synchronized
    fun ensure(context: Context): MediaSession {
        session?.let { return it }
        val player = PersistentNativePlayer.player(context.applicationContext)
        return MediaSession.Builder(context.applicationContext, player).build().also { session = it }
    }

    @Synchronized
    fun release() {
        session?.release()
        session = null
    }
}