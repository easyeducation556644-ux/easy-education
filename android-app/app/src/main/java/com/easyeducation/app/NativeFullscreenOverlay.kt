package com.easyeducation.app

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

/**
 * Fullscreen is a presentation of the process-local player inside MainActivity, not a second
 * Activity/player lifecycle. The same ExoPlayer stays prepared and buffered while the surface
 * morphs between inline and fullscreen.
 */
@UnstableApi
object NativeFullscreenOverlay {
    private var host: Activity? = null
    private var shell: FullscreenShell? = null
    private var playerView: YoutubeStylePlayerView? = null
    private var player: ExoPlayer? = null
    private var originalOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private var originalSystemUi: Int = 0
    private var activeClassId: String = ""
    private var activeSourceUrl: String = ""
    private var activeTitle: String = ""
    private var activeHeight: Int = 480
    private var initialClassId: String = ""
    private var dismissCallback: ((String) -> Unit)? = null
    private var closing = false

    fun show(
        activity: Activity,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
        sourceBounds: Rect? = null,
        onDismiss: (activeClassId: String) -> Unit,
    ) {
        if (host != null && host !== activity) dismiss(immediate = true)
        if (shell != null) return

        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        host = activity
        player = exoPlayer
        activeClassId = classId
        initialClassId = classId
        activeSourceUrl = sourceUrl
        activeTitle = title
        activeHeight = requestedHeight
        dismissCallback = onDismiss
        closing = false
        originalOrientation = activity.requestedOrientation
        originalSystemUi = activity.window.decorView.systemUiVisibility

        val surface = YoutubeStylePlayerView(activity).apply {
            setFullscreenPresentation(true)
            bindPlayer(exoPlayer)
            setTitle(title)
            setLoading(false)
            onBack = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
            onExitFullscreenGesture = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
            onFullscreen = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
        }
        playerView = surface
        bindNavigation(activity)

        val fullscreenShell = FullscreenShell(activity).apply {
            setBackgroundColor(Color.BLACK)
            target = surface
            onExitGesture = { dx, dy ->
                val length = hypot(dx, dy).coerceAtLeast(1f)
                dismiss(animatedDirectionX = dx / length, animatedDirectionY = dy / length)
            }
        }
        shell = fullscreenShell
        fullscreenShell.addView(
            surface,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        root.addView(
            fullscreenShell,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        fullscreenShell.bringToFront()

        // Start close to the inline geometry when it is available, then settle to full window.
        val contentLocation = IntArray(2)
        root.getLocationOnScreen(contentLocation)
        val bounds = sourceBounds
        if (bounds != null && bounds.width() > 0 && bounds.height() > 0 && root.width > 0 && root.height > 0) {
            fullscreenShell.pivotX = 0f
            fullscreenShell.pivotY = 0f
            fullscreenShell.scaleX = (bounds.width().toFloat() / root.width).coerceIn(0.42f, 1f)
            fullscreenShell.scaleY = (bounds.height().toFloat() / root.height).coerceIn(0.30f, 1f)
            fullscreenShell.translationX = (bounds.left - contentLocation[0]).toFloat()
            fullscreenShell.translationY = (bounds.top - contentLocation[1]).toFloat()
            fullscreenShell.alpha = 0.88f
        } else {
            fullscreenShell.scaleX = 0.96f
            fullscreenShell.scaleY = 0.96f
            fullscreenShell.alpha = 0f
        }
        fullscreenShell.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .alpha(1f)
            .setDuration(210L)
            .start()

        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    fun owns(exoPlayer: ExoPlayer): Boolean = player === exoPlayer && shell != null

    fun dismiss(immediate: Boolean = false) {
        if (immediate) finishDismiss() else dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f)
    }

    private fun dismiss(animatedDirectionX: Float, animatedDirectionY: Float) {
        if (closing) return
        val currentShell = shell ?: return
        closing = true
        currentShell.cancelGestureAnimation()
        val distance = max(currentShell.width, currentShell.height).coerceAtLeast(1) * 0.18f
        currentShell.animate()
            .scaleX(0.82f)
            .scaleY(0.82f)
            .translationX(animatedDirectionX * distance)
            .translationY(animatedDirectionY * distance)
            .alpha(0.18f)
            .setDuration(190L)
            .withEndAction { finishDismiss() }
            .start()
    }

    private fun finishDismiss() {
        val activity = host ?: return
        val currentShell = shell
        val surface = playerView
        val callback = dismissCallback
        val finalClassId = activeClassId

        surface?.bindPlayer(null)
        if (currentShell != null) (currentShell.parent as? ViewGroup)?.removeView(currentShell)
        shell = null
        playerView = null
        player = null
        dismissCallback = null
        closing = false

        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility = originalSystemUi
        restoreOrientation(activity)
        host = null
        callback?.invoke(finalClassId)
    }

    private fun restoreOrientation(activity: Activity) {
        if (originalOrientation != ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
            activity.requestedOrientation = originalOrientation
            return
        }
        // Return the watch page to portrait first, then give sensor control back after the morph.
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        Handler(Looper.getMainLooper()).postDelayed({
            if (!activity.isFinishing && !activity.isDestroyed && shell == null) {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }, 520L)
    }

    private fun bindNavigation(activity: Activity) {
        val surface = playerView ?: return
        val previous = PlayerChapterQueue.previous(activeClassId)
        val next = PlayerChapterQueue.next(activeClassId)
        surface.setNavigationAvailability(previous != null, next != null)
        surface.onPrevious = { navigateShared(activity, PlayerChapterQueue.previous(activeClassId)) }
        surface.onNext = { navigateShared(activity, PlayerChapterQueue.next(activeClassId)) }
    }

    private fun navigateShared(activity: Activity, target: PlayerQueueItem?) {
        if (target == null || closing) return
        val component = activity as? ComponentActivity ?: return
        val surface = playerView ?: return
        surface.setLoading(true)
        PersistentNativePlayer.savePosition(activity)
        component.lifecycleScope.launch {
            runCatching {
                PersistentNativePlayer.ensureOnline(
                    context = activity,
                    classId = target.classId,
                    sourceUrl = target.sourceUrl,
                    requestedHeight = target.height,
                    autoPlay = true,
                )
            }.onSuccess {
                activeClassId = target.classId
                activeSourceUrl = target.sourceUrl
                activeTitle = target.title
                activeHeight = target.height
                surface.setTitle(activeTitle)
                surface.setLoading(false)
                bindNavigation(activity)
                PlayerChapterQueue.next(activeClassId)?.let { upcoming ->
                    PersistentNativePlayer.prefetch(
                        activity,
                        upcoming.classId,
                        upcoming.sourceUrl,
                        upcoming.height,
                    )
                }
            }.onFailure {
                surface.setLoading(false)
            }
        }
    }

    /**
     * Parent-level observer: underlying player keeps taps/double-taps/controls, while a sufficiently
     * long/fast pan in any direction exits fullscreen.
     */
    private class FullscreenShell(context: android.content.Context) : FrameLayout(context) {
        var target: View? = null
        var onExitGesture: ((dx: Float, dy: Float) -> Unit)? = null

        private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var eligible = false
        private var dragging = false
        private var progress = 0f
        private var velocity: VelocityTracker? = null

        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            observe(event)
            return super.dispatchTouchEvent(event)
        }

        private fun observe(event: MotionEvent) {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                    dragging = false
                    progress = 0f
                    eligible = isSurfaceZone(event.x, event.y)
                    velocity?.recycle()
                    velocity = VelocityTracker.obtain().also { it.addMovement(event) }
                }

                MotionEvent.ACTION_MOVE -> {
                    velocity?.addMovement(event)
                    if (!eligible) return
                    val dx = event.x - downX
                    val dy = event.y - downY
                    val distance = hypot(dx, dy)
                    if (!dragging && distance > touchSlop * 1.2f) dragging = true
                    if (dragging) {
                        val denominator = (minOf(width, height).coerceAtLeast(dp(180)) * 0.42f)
                        progress = (distance / denominator).coerceIn(0f, 1f)
                        applyTransform(dx, dy, progress)
                    }
                }

                MotionEvent.ACTION_UP -> {
                    velocity?.addMovement(event)
                    velocity?.computeCurrentVelocity(1000)
                    val speed = hypot(velocity?.xVelocity ?: 0f, velocity?.yVelocity ?: 0f)
                    val dx = event.x - downX
                    val dy = event.y - downY
                    val commit = dragging && (progress >= EXIT_FRACTION || speed >= EXIT_VELOCITY_PX_S)
                    velocity?.recycle()
                    velocity = null
                    eligible = false
                    dragging = false
                    if (commit) onExitGesture?.invoke(dx, dy) else animateReset()
                }

                MotionEvent.ACTION_CANCEL -> {
                    velocity?.recycle()
                    velocity = null
                    eligible = false
                    if (dragging) animateReset()
                    dragging = false
                }
            }
        }

        private fun isSurfaceZone(x: Float, y: Float): Boolean {
            if (width <= 0 || height <= 0) return true
            if (y <= dp(68) || y >= height - dp(84)) return false
            val centerBand = abs(y - height / 2f) <= dp(50)
            val centerControls = centerBand && abs(x - width / 2f) <= dp(142)
            return !centerControls
        }

        private fun applyTransform(dx: Float, dy: Float, p: Float) {
            animate().cancel()
            pivotX = width / 2f
            pivotY = height / 2f
            val scale = 1f - 0.12f * p
            scaleX = scale
            scaleY = scale
            translationX = dx * 0.34f
            translationY = dy * 0.34f
            alpha = 1f - 0.16f * p
        }

        private fun animateReset() {
            animate().cancel()
            animate()
                .scaleX(1f)
                .scaleY(1f)
                .translationX(0f)
                .translationY(0f)
                .alpha(1f)
                .setDuration(210L)
                .start()
        }

        fun cancelGestureAnimation() {
            velocity?.recycle()
            velocity = null
            animate().cancel()
        }

        private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

        companion object {
            private const val EXIT_FRACTION = 0.30f
            private const val EXIT_VELOCITY_PX_S = 1150f
        }
    }
}
