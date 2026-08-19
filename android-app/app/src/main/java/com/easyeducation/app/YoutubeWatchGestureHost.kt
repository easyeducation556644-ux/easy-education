package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.util.UnstableApi
import kotlin.math.abs
import kotlin.math.hypot

/**
 * Inline host for the one shared YoutubeStylePlayerView. Once a vertical drag crosses touch slop,
 * this host takes ownership from the player, reparents the same visual player into a top-level drag
 * shell, and leaves the watch page behind it.
 *
 * Important: every touch that starts inside the video is eligible for presentation drag. We do not
 * intercept a normal tap or horizontal seek; interception starts only after a real vertical move
 * crosses touch slop. The previous static top/bottom/center exclusions left large parts of the video
 * on the child's old minimize path, so the new floating-reparent transition often never ran.
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
    private var velocity: VelocityTracker? = null
    private var dragShell: FrameLayout? = null
    private var dragRoot: FrameLayout? = null
    private var sourceX = 0f
    private var sourceY = 0f
    private var sourceWidth = 0
    private var sourceHeight = 0

    init {
        clipChildren = false
        clipToPadding = false
        attachSharedSurface(playerSurface)
    }

    fun attachSharedSurface(surface: YoutubeStylePlayerView = NativeSharedPlayerSurface.obtain(context)): YoutubeStylePlayerView {
        finishDragImmediately(reattach = false)
        (surface.parent as? ViewGroup)?.removeView(surface)
        playerSurface = surface
        NativeSharedPlayerSurface.setMiniPresentation(surface, false)
        addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        surface.bringToFront()
        return surface
    }

    /** Child requests still block LazyColumn/ancestors, but this host keeps permission to intercept. */
    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        parent?.requestDisallowInterceptTouchEvent(disallowIntercept)
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                eligible = isSurfaceZone(event.x, event.y)
                dragging = false
                progress = 0f
                velocity?.recycle()
                velocity = VelocityTracker.obtain().also { it.addMovement(event) }
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                velocity?.addMovement(event)
                if (!eligible) return false
                val dx = event.x - downX
                val dy = event.y - downY
                if (!dragging && dy > touchSlop && abs(dy) > abs(dx) * 0.92f) beginFloatingDrag()
                if (dragging) {
                    updateFloatingDrag(dx, dy)
                    return true
                }
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (!dragging) {
                    velocity?.recycle()
                    velocity = null
                    eligible = false
                }
            }
        }
        return dragging
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!dragging) return super.onTouchEvent(event)
        velocity?.addMovement(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                updateFloatingDrag(event.x - downX, event.y - downY)
                return true
            }

            MotionEvent.ACTION_UP -> {
                velocity?.computeCurrentVelocity(1000)
                val speed = hypot(velocity?.xVelocity ?: 0f, velocity?.yVelocity ?: 0f)
                val commit = progress >= MINI_COMMIT_FRACTION ||
                    ((velocity?.yVelocity ?: 0f) > MINI_COMMIT_VELOCITY && speed > MINI_COMMIT_VELOCITY)
                velocity?.recycle()
                velocity = null
                eligible = false
                dragging = false
                if (commit) commitFloatingDrag() else animateFloatingBack()
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                velocity?.recycle()
                velocity = null
                eligible = false
                dragging = false
                animateFloatingBack()
                return true
            }
        }
        return true
    }

    private fun beginFloatingDrag() {
        val activity = context.findActivity() ?: return
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        val surface = playerSurface
        val rect = Rect()
        if (!surface.getGlobalVisibleRect(rect) || rect.isEmpty) return
        val rootLocation = IntArray(2)
        root.getLocationOnScreen(rootLocation)

        sourceX = (rect.left - rootLocation[0]).toFloat()
        sourceY = (rect.top - rootLocation[1]).toFloat()
        sourceWidth = rect.width().coerceAtLeast(1)
        sourceHeight = rect.height().coerceAtLeast(1)

        val shell = FrameLayout(context).apply {
            clipChildren = true
            clipToOutline = true
            elevation = dp(YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            background = roundedBlack(0f)
            x = sourceX
            y = sourceY
        }
        dragShell = shell
        dragRoot = root
        dragging = true

        NativeSharedPlayerSurface.setMiniPresentation(surface, true)
        (surface.parent as? ViewGroup)?.removeView(surface)
        shell.addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        root.addView(shell, FrameLayout.LayoutParams(sourceWidth, sourceHeight))
        shell.bringToFront()
        parent?.requestDisallowInterceptTouchEvent(true)
        applyBackgroundProgress(0f)
    }

    private fun updateFloatingDrag(dx: Float, dy: Float) {
        val root = dragRoot ?: return
        val shell = dragShell ?: return
        val positiveY = dy.coerceAtLeast(0f)
        val denominator = root.height.coerceAtLeast(dp(360)) * 0.58f
        progress = (positiveY / denominator).coerceIn(0f, 1f)

        val targetScale = 1f - 0.43f * progress
        shell.pivotX = shell.width / 2f
        shell.pivotY = shell.height / 2f
        shell.scaleX = targetScale
        shell.scaleY = targetScale
        shell.x = (sourceX + dx * 0.76f + (root.width - sourceWidth) * 0.10f * progress)
            .coerceIn(-sourceWidth * 0.18f, root.width - sourceWidth * targetScale * 0.72f)
        shell.y = (sourceY + positiveY * 0.84f).coerceAtMost(root.height - sourceHeight * targetScale * 0.30f)
        shell.background = roundedBlack(dpF(YoutubeParityMotion.MINI_CORNER_RADIUS_DP) * progress)
        shell.elevation = dp(YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
        applyBackgroundProgress(progress)
    }

    private fun commitFloatingDrag() {
        val shell = dragShell ?: return resetPagePresentation()
        val surface = playerSurface
        shell.animate().cancel()
        applyBackgroundProgress(1f)
        surface.onMinimize?.invoke()
        post {
            if (surface.parent === shell) shell.removeView(surface)
            (shell.parent as? ViewGroup)?.removeView(shell)
            dragShell = null
            dragRoot = null
            resetPagePresentation()
        }
    }

    private fun animateFloatingBack() {
        val shell = dragShell ?: return resetPagePresentation()
        val surface = playerSurface
        shell.animate().cancel()
        animateBackgroundReset()
        shell.animate()
            .x(sourceX)
            .y(sourceY)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(YoutubeParityMotion.WATCH_MIN_MAX_MS)
            .withEndAction {
                if (surface.parent === shell) shell.removeView(surface)
                (shell.parent as? ViewGroup)?.removeView(shell)
                dragShell = null
                dragRoot = null
                NativeSharedPlayerSurface.setMiniPresentation(surface, false)
                (surface.parent as? ViewGroup)?.removeView(surface)
                if (surface.parent !== this) addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                resetPagePresentation()
            }
            .start()
    }

    private fun composePageRoot(): View? {
        val activity = context.findActivity() ?: return null
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return null
        return content.getChildAt(0)?.takeIf { it !== dragShell }
    }

    private fun applyBackgroundProgress(p: Float) {
        val page = composePageRoot() ?: return
        page.animate().cancel()
        page.pivotX = page.width / 2f
        page.pivotY = page.height / 2f
        val scale = 1f - 0.018f * p
        page.scaleX = scale
        page.scaleY = scale
        page.alpha = 1f - 0.48f * p
    }

    private fun animateBackgroundReset() {
        val page = composePageRoot() ?: return
        page.animate().cancel()
        page.animate()
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
            .start()
    }

    private fun resetPageImmediately(page: View) {
        page.animate().cancel()
        page.pivotX = page.width / 2f
        page.pivotY = page.height / 2f
        page.scaleX = 1f
        page.scaleY = 1f
        page.translationX = 0f
        page.translationY = 0f
        page.alpha = 1f
    }

    private fun finishDragImmediately(reattach: Boolean) {
        val shell = dragShell ?: return
        val surface = playerSurface
        if (surface.parent === shell) shell.removeView(surface)
        (shell.parent as? ViewGroup)?.removeView(shell)
        dragShell = null
        dragRoot = null
        if (reattach) {
            NativeSharedPlayerSurface.setMiniPresentation(surface, false)
            (surface.parent as? ViewGroup)?.removeView(surface)
            addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        resetPagePresentation()
    }

    fun resetPagePresentation() {
        composePageRoot()?.let(::resetPageImmediately)
        playerSurface.animate().cancel()
        playerSurface.scaleX = 1f
        playerSurface.scaleY = 1f
        playerSurface.translationX = 0f
        playerSurface.translationY = 0f
        playerSurface.alpha = 1f
    }

    fun globalBounds(): Rect {
        val transformed = Rect()
        if (playerSurface.getGlobalVisibleRect(transformed) && !transformed.isEmpty) return transformed
        val location = IntArray(2)
        getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + width, location[1] + height)
    }

    private fun isSurfaceZone(x: Float, y: Float): Boolean {
        // The host itself is exactly the inline video bounds. Every DOWN inside it is eligible;
        // taps still go to the child because we intercept only after a vertical move crosses slop.
        return x >= 0f && x <= width.toFloat() && y >= 0f && y <= height.toFloat()
    }

    private fun roundedBlack(radius: Float) = GradientDrawable().apply {
        setColor(Color.BLACK)
        cornerRadius = radius
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
    private fun dpF(value: Int): Float = value * resources.displayMetrics.density

    companion object {
        private const val MINI_COMMIT_FRACTION = 0.30f
        private const val MINI_COMMIT_VELOCITY = 900f
    }
}
