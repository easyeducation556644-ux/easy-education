package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.util.UnstableApi
import kotlin.math.abs

/**
 * Inline host for the one shared YoutubeStylePlayerView. The view itself is not recreated when the
 * player moves to fullscreen/mini; it is reparented back into this host. The host also mirrors the
 * watch-page motion during drag-to-mini so the whole page participates in the gesture.
 */
@UnstableApi
class YoutubeWatchGestureHost(context: Context) : FrameLayout(context) {
    var playerSurface: YoutubeStylePlayerView = NativeSharedPlayerSurface.obtain(context)
        private set

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var eligible = false
    private var dragging = false
    private var progress = 0f

    init {
        clipChildren = false
        clipToPadding = false
        attachSharedSurface(playerSurface)
    }

    fun attachSharedSurface(surface: YoutubeStylePlayerView = NativeSharedPlayerSurface.obtain(context)): YoutubeStylePlayerView {
        if (playerSurface !== surface || surface.parent !== this) {
            (surface.parent as? ViewGroup)?.removeView(surface)
            playerSurface = surface
            surface.animate().cancel()
            resetSurfaceTransform(surface)
            addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        surface.bringToFront()
        return surface
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        observePageDrag(event)
        return super.dispatchTouchEvent(event)
    }

    private fun observePageDrag(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                dragging = false
                progress = 0f
                eligible = isSurfaceZone(event.x, event.y)
            }

            MotionEvent.ACTION_MOVE -> if (eligible) {
                val dx = event.x - downX
                val dy = event.y - downY
                if (!dragging && dy > touchSlop && abs(dy) > abs(dx) * 1.05f) dragging = true
                if (dragging) {
                    val dragY = dy.coerceAtLeast(0f)
                    val denominator = height.coerceAtLeast(dp(180)) * 0.70f
                    progress = (dragY / denominator).coerceIn(0f, 1f)
                    applyPageTransform(dragY, progress)
                }
            }

            MotionEvent.ACTION_UP -> {
                if (dragging) {
                    if (progress >= MINI_COMMIT_FRACTION) animatePageCommit() else animatePageReset()
                }
                eligible = false
                dragging = false
            }

            MotionEvent.ACTION_CANCEL -> {
                if (dragging) animatePageReset()
                eligible = false
                dragging = false
            }
        }
    }

    private fun isSurfaceZone(x: Float, y: Float): Boolean {
        if (width <= 0 || height <= 0) return true
        if (y <= dp(66) || y >= height - dp(82)) return false
        val centerBand = abs(y - height / 2f) <= dp(48)
        val centerControls = centerBand && abs(x - width / 2f) <= dp(132)
        return !centerControls
    }

    private fun composePageRoot(): View? {
        val activity = context.findActivity() ?: return null
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return null
        return content.getChildAt(0)?.takeIf { it !== this }
    }

    private fun applyPageTransform(dragY: Float, p: Float) {
        val page = composePageRoot() ?: return
        page.animate().cancel()
        page.pivotX = page.width / 2f
        page.pivotY = 0f
        val scale = 1f - 0.045f * p
        page.scaleX = scale
        page.scaleY = scale
        page.translationY = (dragY * 0.12f).coerceAtMost(dp(46).toFloat())
        page.alpha = 1f - 0.34f * p
    }

    private fun animatePageCommit() {
        val page = composePageRoot() ?: return
        page.animate().cancel()
        page.animate()
            .scaleX(0.95f)
            .scaleY(0.95f)
            .translationY(dp(48).toFloat())
            .alpha(0.58f)
            .setDuration(155L)
            .withEndAction { postDelayed({ resetPageImmediately(page) }, 105L) }
            .start()
    }

    private fun animatePageReset() {
        val page = composePageRoot() ?: return
        page.animate().cancel()
        page.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .alpha(1f)
            .setDuration(220L)
            .withEndAction { resetPageImmediately(page) }
            .start()
    }

    private fun resetPageImmediately(page: View) {
        page.pivotX = page.width / 2f
        page.pivotY = page.height / 2f
        page.scaleX = 1f
        page.scaleY = 1f
        page.translationX = 0f
        page.translationY = 0f
        page.alpha = 1f
    }

    private fun resetSurfaceTransform(surface: View) {
        surface.pivotX = surface.width / 2f
        surface.pivotY = surface.height / 2f
        surface.scaleX = 1f
        surface.scaleY = 1f
        surface.translationX = 0f
        surface.translationY = 0f
        surface.alpha = 1f
    }

    fun resetPagePresentation() {
        composePageRoot()?.let(::resetPageImmediately)
        resetSurfaceTransform(playerSurface)
    }

    fun globalBounds(): Rect {
        val transformed = Rect()
        if (playerSurface.getGlobalVisibleRect(transformed) && !transformed.isEmpty) return transformed
        val location = IntArray(2)
        getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + width, location[1] + height)
    }

    private fun Context.findActivity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return current as? Activity
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val MINI_COMMIT_FRACTION = 0.28f
    }
}
