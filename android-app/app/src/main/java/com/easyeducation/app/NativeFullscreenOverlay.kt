package com.easyeducation.app

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
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
 * Single-activity fullscreen presentation of the same prepared ExoPlayer session.
 * The black scrim and video surface are separate, so a pan reveals the already-rendered watch page
 * underneath while the video follows the finger. The parent owns the exit pan after touch slop;
 * the child player receives taps/double-taps/controls before that, avoiding double transforms.
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

        val fullscreenShell = FullscreenShell(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            target = surface
            onExitGesture = { dx, dy ->
                val length = hypot(dx, dy).coerceAtLeast(1f)
                dismiss(animatedDirectionX = dx / length, animatedDirectionY = dy / length)
            }
        }
        shell = fullscreenShell

        val scrim = View(activity).apply { setBackgroundColor(Color.BLACK) }
        fullscreenShell.scrim = scrim
        fullscreenShell.addView(
            scrim,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        fullscreenShell.addView(
            surface,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        root.addView(
            fullscreenShell,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        fullscreenShell.bringToFront()
        bindNavigation(activity)

        val contentLocation = IntArray(2)
        root.getLocationOnScreen(contentLocation)
        val bounds = sourceBounds
        scrim.alpha = 0f
        if (bounds != null && bounds.width() > 0 && bounds.height() > 0 && root.width > 0 && root.height > 0) {
            surface.pivotX = 0f
            surface.pivotY = 0f
            surface.scaleX = (bounds.width().toFloat() / root.width).coerceIn(0.32f, 1f)
            surface.scaleY = (bounds.height().toFloat() / root.height).coerceIn(0.24f, 1f)
            surface.translationX = (bounds.left - contentLocation[0]).toFloat()
            surface.translationY = (bounds.top - contentLocation[1]).toFloat()
        } else {
            surface.scaleX = 0.94f
            surface.scaleY = 0.94f
            surface.alpha = 0.92f
        }
        scrim.animate().alpha(1f).setDuration(185L).start()
        surface.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .alpha(1f)
            .setDuration(225L)
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
        val surface = playerView ?: return finishDismiss()
        closing = true
        currentShell.cancelGestureAnimation()

        val distance = max(currentShell.width, currentShell.height).coerceAtLeast(1) * 0.46f
        currentShell.scrim?.animate()?.alpha(0f)?.setDuration(190L)?.start()
        surface.animate()
            .scaleX(0.73f)
            .scaleY(0.73f)
            .translationX(animatedDirectionX * distance)
            .translationY(animatedDirectionY * distance)
            .alpha(0.42f)
            .setDuration(195L)
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
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        Handler(Looper.getMainLooper()).postDelayed({
            if (!activity.isFinishing && !activity.isDestroyed && shell == null) {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }, 460L)
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
                    PersistentNativePlayer.prefetch(activity, upcoming.classId, upcoming.sourceUrl, upcoming.height)
                }
            }.onFailure { surface.setLoading(false) }
        }
    }

    private class FullscreenShell(context: android.content.Context) : FrameLayout(context) {
        var target: View? = null
        var scrim: View? = null
        var onExitGesture: ((dx: Float, dy: Float) -> Unit)? = null

        private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var eligible = false
        private var dragging = false
        private var progress = 0f
        private var velocity: VelocityTracker? = null

        override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                    dragging = false
                    progress = 0f
                    eligible = isSurfaceZone(event.x, event.y)
                    velocity?.recycle()
                    velocity = VelocityTracker.obtain().also { it.addMovement(event) }
                    return false
                }

                MotionEvent.ACTION_MOVE -> {
                    velocity?.addMovement(event)
                    if (!eligible) return false
                    val dx = event.x - downX
                    val dy = event.y - downY
                    val distance = hypot(dx, dy)
                    if (!dragging && distance > touchSlop * 1.15f) {
                        dragging = true
                    }
                    if (dragging) {
                        updateDrag(dx, dy)
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
            if (!dragging && event.actionMasked != MotionEvent.ACTION_DOWN) return super.onTouchEvent(event)
            velocity?.addMovement(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_MOVE -> {
                    updateDrag(event.x - downX, event.y - downY)
                    return true
                }

                MotionEvent.ACTION_UP -> {
                    velocity?.computeCurrentVelocity(1000)
                    val speed = hypot(velocity?.xVelocity ?: 0f, velocity?.yVelocity ?: 0f)
                    val dx = event.x - downX
                    val dy = event.y - downY
                    val commit = progress >= EXIT_FRACTION || speed >= EXIT_VELOCITY_PX_S
                    finishGestureState()
                    if (commit) onExitGesture?.invoke(dx, dy) else animateReset()
                    return true
                }

                MotionEvent.ACTION_CANCEL -> {
                    finishGestureState()
                    animateReset()
                    return true
                }
            }
            return true
        }

        private fun updateDrag(dx: Float, dy: Float) {
            val distance = hypot(dx, dy)
            val denominator = minOf(width, height).coerceAtLeast(dp(180)) * 0.56f
            progress = (distance / denominator).coerceIn(0f, 1f)
            applyTransform(dx, dy, progress)
        }

        private fun finishGestureState() {
            velocity?.recycle()
            velocity = null
            eligible = false
            dragging = false
        }

        private fun isSurfaceZone(x: Float, y: Float): Boolean {
            if (width <= 0 || height <= 0) return true
            if (y <= dp(66) || y >= height - dp(82)) return false
            val centerBand = abs(y - height / 2f) <= dp(52)
            val centerControls = centerBand && abs(x - width / 2f) <= dp(144)
            return !centerControls
        }

        private fun applyTransform(dx: Float, dy: Float, p: Float) {
            val video = target ?: return
            video.animate().cancel()
            scrim?.animate()?.cancel()
            video.pivotX = width / 2f
            video.pivotY = height / 2f
            val scale = 1f - 0.19f * p
            video.scaleX = scale
            video.scaleY = scale
            video.translationX = dx * 0.62f
            video.translationY = dy * 0.62f
            video.alpha = 1f
            video.elevation = dp(14).toFloat() * p
            if (p > 0.06f) {
                video.clipToOutline = true
                video.outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
                video.background = GradientDrawable().apply {
                    setColor(Color.BLACK)
                    cornerRadius = dp((18f * p).toInt().coerceAtLeast(1)).toFloat()
                }
            }
            scrim?.alpha = (1f - 0.92f * p).coerceIn(0.05f, 1f)
        }

        private fun animateReset() {
            val video = target ?: return
            video.animate().cancel()
            scrim?.animate()?.cancel()
            scrim?.animate()?.alpha(1f)?.setDuration(190L)?.start()
            video.animate()
                .scaleX(1f)
                .scaleY(1f)
                .translationX(0f)
                .translationY(0f)
                .alpha(1f)
                .setDuration(215L)
                .withEndAction {
                    video.elevation = 0f
                    video.clipToOutline = false
                    video.background = null
                }
                .start()
        }

        fun cancelGestureAnimation() {
            velocity?.recycle()
            velocity = null
            target?.animate()?.cancel()
            scrim?.animate()?.cancel()
        }

        private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

        companion object {
            private const val EXIT_FRACTION = 0.27f
            private const val EXIT_VELOCITY_PX_S = 980f
        }
    }
}
