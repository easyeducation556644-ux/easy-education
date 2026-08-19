package com.easyeducation.app

import android.graphics.BitmapFactory
import android.graphics.drawable.AnimationDrawable
import android.graphics.drawable.BitmapDrawable
import android.util.Base64
import android.view.ViewGroup
import androidx.appcompat.widget.AppCompatImageButton
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.WeakHashMap

/**
 * Exact permitted YouTube 21.33.322 pause↔play frame animation used by the video controls.
 * The source animation-list is 10 frames: 66ms + 8×33ms + 66ms, reversed for play→pause.
 */
object YoutubeExactPlayPauseFrames {
    private data class Binding(val player: ExoPlayer, val listener: Player.Listener)
    private val bindings = WeakHashMap<YoutubeStylePlayerView, Binding>()
    private val durations = intArrayOf(66, 33, 33, 33, 33, 33, 33, 33, 33, 66)

    @Synchronized
    fun bind(surface: YoutubeStylePlayerView, player: ExoPlayer) {
        val existing = bindings[surface]
        if (existing?.player === player) {
            surface.post { setFinal(surface, pause = player.isPlaying) }
            return
        }
        if (existing != null) existing.player.removeListener(existing.listener)

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                // YoutubeStylePlayerView also updates accessibility/chrome from its own listener.
                // Post the permitted frame animation so it is the final visual update for this event.
                surface.post { animate(surface, toPause = isPlaying) }
            }
        }
        bindings[surface] = Binding(player, listener)
        player.addListener(listener)
        surface.post { setFinal(surface, pause = player.isPlaying) }
    }

    @Synchronized
    fun unbind(surface: YoutubeStylePlayerView) {
        bindings.remove(surface)?.let { it.player.removeListener(it.listener) }
    }

    private fun animate(surface: YoutubeStylePlayerView, toPause: Boolean) {
        val button = playPauseButton(surface) ?: return
        button.animate().cancel()
        button.rotation = 0f
        button.scaleX = 1f
        button.scaleY = 1f
        button.alpha = 1f
        val order = if (toPause) FRAMES.indices.reversed() else FRAMES.indices
        val animation = AnimationDrawable().apply {
            isOneShot = true
            order.forEachIndexed { index, frameIndex ->
                addFrame(frameDrawable(button, FRAMES[frameIndex]), durations[index])
            }
        }
        button.setImageDrawable(animation)
        animation.start()
    }

    private fun setFinal(surface: YoutubeStylePlayerView, pause: Boolean) {
        val button = playPauseButton(surface) ?: return
        button.animate().cancel()
        button.rotation = 0f
        button.scaleX = 1f
        button.scaleY = 1f
        button.alpha = 1f
        val index = if (pause) 0 else FRAMES.lastIndex
        button.setImageDrawable(frameDrawable(button, FRAMES[index]))
    }

    private fun frameDrawable(button: AppCompatImageButton, encoded: String): BitmapDrawable {
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        return BitmapDrawable(button.resources, bitmap).apply {
            setTargetDensity(android.util.DisplayMetrics.DENSITY_XHIGH)
        }
    }

    private fun playPauseButton(surface: YoutubeStylePlayerView): AppCompatImageButton? {
        val controls = surface.getChildAtOrNull(1) as? ViewGroup ?: return null
        val center = controls.getChildAtOrNull(1) as? ViewGroup ?: return null
        return center.getChildAtOrNull(1) as? AppCompatImageButton
    }

    private fun ViewGroup.getChildAtOrNull(index: Int) = if (index in 0 until childCount) getChildAt(index) else null

    private val FRAMES = arrayOf(
        "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"
    )
}
