package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.util.UnstableApi

/**
 * Owns the single visual player view used by inline watch, fullscreen and in-app mini modes.
 * The same YoutubeStylePlayerView is reparented inside MainActivity instead of creating another
 * PlayerView for each presentation. This mirrors the permitted YouTube player-reparenting
 * architecture and prevents presentation changes from creating a second video surface/controller.
 */
@UnstableApi
object NativeSharedPlayerSurface {
    private var hostActivity: Activity? = null
    private var surface: YoutubeStylePlayerView? = null

    @Synchronized
    fun obtain(context: Context): YoutubeStylePlayerView {
        val activity = context.findActivity()
        val exo = PersistentNativePlayer.player(context.applicationContext)
        val current = surface
        if (current != null && (activity == null || hostActivity === activity)) {
            setMiniPresentation(current, false)
            YoutubeExactPlayerIcons.apply(current, fullscreen = false)
            YoutubeExactPlayPauseFrames.bind(current, exo)
            current.post { YoutubeReparentableTextureSurface.ensure(current, exo) }
            return current
        }

        surface?.let { old ->
            YoutubeExactPlayPauseFrames.unbind(old)
            YoutubeReparentableTextureSurface.release(old)
            (old.parent as? ViewGroup)?.removeView(old)
            old.bindPlayer(null)
        }
        return YoutubeStylePlayerView(activity ?: context).also { created ->
            hostActivity = activity
            surface = created
            YoutubeExactPlayerIcons.apply(created, fullscreen = false)
            YoutubeExactPlayPauseFrames.bind(created, exo)
            // Run after the inline binding in this UI frame so Media3's default SurfaceView cannot
            // overwrite the retained TextureView decoder output.
            created.post { YoutubeReparentableTextureSurface.ensure(created, exo) }
        }
    }

    @Synchronized
    fun detach(): YoutubeStylePlayerView? {
        val current = surface ?: return null
        (current.parent as? ViewGroup)?.removeView(current)
        setMiniPresentation(current, false)
        return current
    }

    @Synchronized
    fun current(): YoutubeStylePlayerView? = surface

    /** The shared view's first child is video and the later children are our own chrome/hints. */
    fun setMiniPresentation(surface: YoutubeStylePlayerView, mini: Boolean) {
        surface.setFullscreenPresentation(false)
        if (mini) {
            for (index in 1 until surface.childCount) surface.getChildAt(index).visibility = View.GONE
        } else {
            if (surface.childCount > 1) surface.getChildAt(1).visibility = View.VISIBLE
            for (index in 2 until surface.childCount) surface.getChildAt(index).visibility = View.INVISIBLE
            YoutubeExactPlayerIcons.apply(surface, fullscreen = false)
        }
        surface.animate().cancel()
        surface.scaleX = 1f
        surface.scaleY = 1f
        surface.translationX = 0f
        surface.translationY = 0f
        surface.alpha = 1f
        surface.elevation = 0f
        surface.clipToOutline = false
        surface.background = null
    }

    @Synchronized
    fun clear() {
        surface?.let { current ->
            YoutubeExactPlayPauseFrames.unbind(current)
            YoutubeReparentableTextureSurface.release(current)
            (current.parent as? ViewGroup)?.removeView(current)
            current.bindPlayer(null)
        }
        surface = null
        hostActivity = null
    }

    private fun Context.findActivity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return current as? Activity
    }
}
