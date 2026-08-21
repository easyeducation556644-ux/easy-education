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
import android.view.ViewTreeObserver
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import androidx.media3.common.util.UnstableApi
import kotlin.math.abs
import kotlin.math.hypot

data class NativeMiniPlayerHandoff(
    val shell: FrameLayout,
    val surface: YoutubeStylePlayerView,
    val bounds: Rect,
)

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
    private var attachedSurface: YoutubeStylePlayerView? = null

    val playerSurface: YoutubeStylePlayerView?
        get() = attachedSurface

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
    private var presentationPage: View? = null
    private var hasBackdrop = false
    private var handoffClaimed = false

    init {
        clipChildren = false
        clipToPadding = false
    }

    fun attachSharedSurface(surface: YoutubeStylePlayerView = NativeSharedPlayerSurface.obtain(context)): YoutubeStylePlayerView {
        if (attachedSurface != null) finishDragImmediately(reattach = false)
        (surface.parent as? ViewGroup)?.removeView(surface)
        attachedSurface = surface
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
        val surface = attachedSurface ?: return
        val rect = Rect()
        if (!surface.getGlobalVisibleRect(rect) || rect.isEmpty) return
        val rootLocation = IntArray(2)
        root.getLocationOnScreen(rootLocation)
        presentationPage = composePageRoot()
        hasBackdrop = presentationPage?.let { page ->
            NativeWatchBackdrop.attachBelow(activity, page) != null
        } == true

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
        handoffClaimed = false

        surface.cancelPendingSurfaceGesture()
        NativeSharedPlayerSurface.setMiniPresentation(surface, true)
        (surface.parent as? ViewGroup)?.removeView(surface)
        shell.addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        root.addView(shell, FrameLayout.LayoutParams(sourceWidth, sourceHeight))
        shell.bringToFront()
        parent?.requestDisallowInterceptTouchEvent(true)
        applyBackgroundProgress(0f, 0f)
    }

    private fun updateFloatingDrag(dx: Float, dy: Float) {
        val root = dragRoot ?: return
        val shell = dragShell ?: return
        val positiveY = dy.coerceAtLeast(0f)
        val miniWidth = dp(if (resources.configuration.smallestScreenWidthDp >= 600) 340 else 252)
        val miniHeight = (miniWidth * 9f / 16f).toInt()
        val miniInset = dp(YoutubeParityMotion.MINI_INSET_DP)
        val targetX = (root.width - miniWidth - miniInset).coerceAtLeast(0).toFloat()
        val targetY = (root.height - miniHeight - dp(MINI_BOTTOM_CLEARANCE_DP)).coerceAtLeast(0).toFloat()
        val denominator = (targetY - sourceY).coerceAtLeast(root.height.coerceAtLeast(dp(360)) * 0.38f)
        progress = (positiveY / denominator).coerceIn(0f, 1f)

        val targetScaleX = miniWidth.toFloat() / sourceWidth.coerceAtLeast(1)
        val targetScaleY = miniHeight.toFloat() / sourceHeight.coerceAtLeast(1)
        val scaleXNow = lerp(1f, targetScaleX, progress)
        val scaleYNow = lerp(1f, targetScaleY, progress)
        shell.pivotX = 0f
        shell.pivotY = 0f
        shell.scaleX = scaleXNow
        shell.scaleY = scaleYNow
        val horizontalFollow = dx * (1f - progress) * 0.20f
        val visualWidth = sourceWidth * scaleXNow
        val visualHeight = sourceHeight * scaleYNow
        shell.x = (lerp(sourceX, targetX, progress) + horizontalFollow)
            .coerceIn(0f, (root.width - visualWidth).coerceAtLeast(0f))
        shell.y = lerp(sourceY, targetY, progress)
            .coerceIn(0f, (root.height - visualHeight).coerceAtLeast(0f))
        val visualScale = ((scaleXNow + scaleYNow) / 2f).coerceAtLeast(0.08f)
        shell.background = roundedBlack(
            dpF(YoutubeParityMotion.MINI_CORNER_RADIUS_DP) * progress / visualScale,
        )
        shell.elevation = dp(YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
        applyBackgroundProgress(progress, positiveY)
    }

    private fun commitFloatingDrag() {
        val shell = dragShell ?: return resetPagePresentation()
        val surface = attachedSurface ?: return resetPagePresentation()
        shell.animate().cancel()
        presentationPage?.let { page ->
            page.animate().cancel()
            if (hasBackdrop) page.alpha = 0f
        }
        surface.onMinimize?.invoke()
        if (!handoffClaimed) {
            if (surface.parent === shell) shell.removeView(surface)
            (shell.parent as? ViewGroup)?.removeView(shell)
        }
        dragShell = null
        dragRoot = null
        settleCommittedPage()
        handoffClaimed = false
    }

    private fun animateFloatingBack() {
        val shell = dragShell ?: return resetPagePresentation()
        val surface = attachedSurface ?: return resetPagePresentation()
        shell.animate().cancel()
        animateBackgroundReset()
        shell.animate()
            .x(sourceX)
            .y(sourceY)
            .scaleX(1f)
            .scaleY(1f)
            .setInterpolator(WATCH_EASING)
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
                releaseBackdrop(clearSnapshot = false)
            }
            .start()
    }

    private fun composePageRoot(): View? {
        val activity = context.findActivity() ?: return null
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return null
        var current: View = this
        while (current.parent is View && current.parent !== content) {
            current = current.parent as View
        }
        return current.takeIf { it.parent === content && it !== dragShell }
    }

    private fun applyBackgroundProgress(p: Float, dragY: Float) {
        val page = presentationPage ?: composePageRoot() ?: return
        page.animate().cancel()
        page.pivotX = page.width / 2f
        page.pivotY = 0f
        val scale = 1f - 0.014f * p
        page.scaleX = scale
        page.scaleY = scale
        page.translationY = dragY * 0.84f
        page.alpha = if (hasBackdrop) (1f - 1.18f * p).coerceAtLeast(0.18f) else 1f
    }

    private fun animateBackgroundReset() {
        val page = presentationPage ?: composePageRoot() ?: return
        page.animate().cancel()
        page.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .alpha(1f)
            .setInterpolator(WATCH_EASING)
            .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
            .start()
    }

    private fun settleCommittedPage() {
        val page = presentationPage
        if (page == null) {
            resetPagePresentation()
            releaseBackdrop(clearSnapshot = true)
            return
        }

        var drawCount = 0
        var completed = false
        lateinit var listener: ViewTreeObserver.OnPreDrawListener
        fun complete() {
            if (completed) return
            completed = true
            val observer = page.viewTreeObserver
            if (observer.isAlive) observer.removeOnPreDrawListener(listener)
            resetPageImmediately(page)
            resetPagePresentation()
            releaseBackdrop(clearSnapshot = true)
        }

        listener = ViewTreeObserver.OnPreDrawListener {
            drawCount += 1
            if (drawCount >= 2) page.post { complete() }
            true
        }
        val observer = page.viewTreeObserver
        if (observer.isAlive) observer.addOnPreDrawListener(listener) else complete()
        page.postDelayed({ complete() }, HANDOFF_MAX_WAIT_MS)
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
        val surface = attachedSurface
        val shell = dragShell
        if (shell != null && surface != null && surface.parent === shell) shell.removeView(surface)
        if (shell != null) (shell.parent as? ViewGroup)?.removeView(shell)
        dragShell = null
        dragRoot = null
        if (reattach && surface != null) {
            NativeSharedPlayerSurface.setMiniPresentation(surface, false)
            (surface.parent as? ViewGroup)?.removeView(surface)
            addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        resetPagePresentation()
        releaseBackdrop(clearSnapshot = false)
    }

    fun resetPagePresentation() {
        (presentationPage ?: composePageRoot())?.let(::resetPageImmediately)
        attachedSurface?.let { surface ->
            surface.animate().cancel()
            surface.scaleX = 1f
            surface.scaleY = 1f
            surface.translationX = 0f
            surface.translationY = 0f
            surface.alpha = 1f
        }
    }

    /** Transfer the exact shell currently under the finger; no reparent/frame swap is needed. */
    fun claimMiniPlayerHandoff(): NativeMiniPlayerHandoff? {
        val shell = dragShell ?: return null
        val surface = attachedSurface ?: return null
        if (surface.parent !== shell) return null
        val bounds = Rect()
        if (!shell.getGlobalVisibleRect(bounds) || bounds.isEmpty) return null
        handoffClaimed = true
        dragShell = null
        dragRoot = null
        return NativeMiniPlayerHandoff(shell = shell, surface = surface, bounds = bounds)
    }

    private fun releaseBackdrop(clearSnapshot: Boolean) {
        NativeWatchBackdrop.detach(clearSnapshot)
        presentationPage = null
        hasBackdrop = false
    }

    fun globalBounds(): Rect {
        val transformed = Rect()
        val surface = attachedSurface
        if (surface != null && surface.getGlobalVisibleRect(transformed) && !transformed.isEmpty) return transformed
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
    private fun lerp(start: Float, end: Float, amount: Float): Float = start + (end - start) * amount

    companion object {
        private const val MINI_COMMIT_FRACTION = 0.30f
        private const val MINI_COMMIT_VELOCITY = 900f
        private const val MINI_BOTTOM_CLEARANCE_DP = 82
        private const val HANDOFF_MAX_WAIT_MS = 260L
        private val WATCH_EASING = PathInterpolator(0.2f, 0f, 0f, 1f)
    }
}
