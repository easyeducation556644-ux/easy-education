package com.easyeducation.app

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * Keeps the decoder output on a TextureView whose SurfaceTexture survives temporary detach/attach
 * while the one player view is reparented between inline, fullscreen and mini containers.
 * Presentation changes therefore do not replace the MediaSource or ExoPlayer video output.
 */
@UnstableApi
object YoutubeReparentableTextureSurface {
    private data class Binding(
        val texture: RetainedTextureView,
        val playerRef: WeakReference<ExoPlayer>,
        val oldSurface: View?,
    )

    private val bindings = WeakHashMap<YoutubeStylePlayerView, Binding>()

    @Synchronized
    fun ensure(surface: YoutubeStylePlayerView, player: ExoPlayer) {
        val current = bindings[surface]
        if (current != null) {
            if (current.playerRef.get() !== player) {
                current.playerRef.get()?.clearVideoTextureView(current.texture)
                player.setVideoTextureView(current.texture)
                bindings[surface] = current.copy(playerRef = WeakReference(player))
            }
            return
        }

        val media3View = surface.getChildAtOrNull(0) as? PlayerView ?: return
        val oldVideoSurface = media3View.videoSurfaceView
        val videoParent = oldVideoSurface?.parent as? ViewGroup ?: return
        val oldIndex = videoParent.indexOfChild(oldVideoSurface).coerceAtLeast(0)

        val texture = RetainedTextureView(surface.context).apply {
            isOpaque = true
            layoutParams = oldVideoSurface.layoutParams
        }
        videoParent.addView(texture, oldIndex)
        oldVideoSurface.visibility = View.INVISIBLE
        player.setVideoTextureView(texture)
        bindings[surface] = Binding(texture, WeakReference(player), oldVideoSurface)
    }

    @Synchronized
    fun release(surface: YoutubeStylePlayerView) {
        val binding = bindings.remove(surface) ?: return
        binding.playerRef.get()?.clearVideoTextureView(binding.texture)
        (binding.texture.parent as? ViewGroup)?.removeView(binding.texture)
        binding.oldSurface?.visibility = View.VISIBLE
        binding.texture.releaseRetainedTexture()
    }

    private fun ViewGroup.getChildAtOrNull(index: Int): View? =
        if (index in 0 until childCount) getChildAt(index) else null
}

/** SurfaceTexture is deliberately retained when Android detaches the view during a same-window reparent. */
private class RetainedTextureView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
    private var retained: SurfaceTexture? = null
    private var released = false

    init {
        surfaceTextureListener = this
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val saved = retained
        if (!released && saved != null && !isAvailable) {
            runCatching { setSurfaceTexture(saved) }
        }
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (retained == null) retained = surface
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        if (released) return true
        retained = surface
        // false = app keeps ownership; on the next attach the same SurfaceTexture is restored.
        return false
    }

    fun releaseRetainedTexture() {
        if (released) return
        released = true
        val saved = retained
        retained = null
        if (saved != null && saved !== surfaceTexture) runCatching { saved.release() }
    }
}
