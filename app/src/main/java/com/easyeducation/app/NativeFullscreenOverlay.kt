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
import android.view.animation.PathInterpolator
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
 * Single-activity fullscreen presentation of the same prepared ExoPlayer and the same visual player
 * view used inline. A translucent scrim is separate from the player surface, so dragging reveals the
 * already-rendered watch page behind it while the one player view follows the finger.
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
    private val watchEasing = PathInterpolator(0.2f, 0f, 0f, 1f)
    private val exitEasing = PathInterpolator(0.4f, 0f, 1f, 1f)

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

        val surface = NativeSharedPlayerSurface.detach() ?: NativeSharedPlayerSurface.obtain(activity)
        surface.animate().cancel()
        surface.pivotX = surface.width / 2f
        surface.pivotY = surface.height / 2f
        surface.scaleX = 1f
        surface.scaleY = 1f
        surface.translationX = 0f
        surface.translationY = 0f
        surface.alpha = 1f
        surface.clipToOutline = false
        surface.background = null
        surface.setFullscreenPresentation(true)
        surface.bindPlayer(exoPlayer)
        surface.setTitle(title)
        surface.setLoading(false)
        surface.onBack = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
        surface.onExitFullscreenGesture = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
        surface.onFullscreen = { dismiss(animatedDirectionX = 0f, animatedDirectionY = 1f) }
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
        scrim.animate().alpha(1f).setDuration(YoutubeParityMotion.WATCH_REVEAL_FROM_BOTTOM_MS).start()
        surface.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .alpha(1f)
            .setInterpolator(watchEasing)
            .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
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

        val distance = max(currentShell.width, currentShell.height).coerceAtLeast(1) * 0.32f
        currentShell.scrim?.animate()?.alpha(0f)?.setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)?.start()
        surface.animate()
            .scaleX(0.76f)
            .scaleY(0.76f)
            .translationX(animatedDirectionX * distance)
            .translationY(animatedDirectionY * distance)
            .alpha(0.96f)
            .setInterpolator(exitEasing)
            .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
            .withEndAction { finishDismiss() }
            .start()
    }

    private fun finishDismiss() {
        val activity = host ?: return
        val currentShell = shell
        val surface = playerView
        val callback = dismissCallback
        val finalClassId = activeClassId

        surface?.let { (it.parent as? ViewGroup)?.removeView(it) }
        if (currentShell != null) (currentShell.parent as? ViewGroup)?.removeView(currentShell)
        surface?.apply {
            animate().cancel()
            scaleX = 1f
            scaleY = 1f
            translationX = 0f
            translationY = 0f
            alpha = 1f
            elevation = 0f
            clipToOutline = false
            background = null
        }
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
        }, YoutubeParityMotion.WATCH_MIN_MAX_MS)
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

        /** Keep the player from blocking this shell's vertical presentation gesture. */
        override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
            parent?.requestDisallowInterceptTouchEvent(disallowIntercept)
        }

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
                    if (
                        !dragging &&
                        dy > touchSlop &&
                        abs(dy) > abs(dx) * 0.86f
                    ) {
                        dragging = true
                        (target as? YoutubeStylePlayerView)?.cancelPendingSurfaceGesture()
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
                    val yVelocity = velocity?.yVelocity ?: 0f
                    val dx = event.x - downX
                    val dy = event.y - downY
                    val commit = progress >= EXIT_FRACTION ||
                        (dy > 0f && yVelocity >= EXIT_VELOCITY_PX_S)
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
            val positiveY = dy.coerceAtLeast(0f)
            val denominator = height.coerceAtLeast(dp(180)) * 0.55f
            progress = (positiveY / denominator).coerceIn(0f, 1f)
            applyTransform(dx, positiveY, progress)
        }

        private fun finishGestureState() {
            velocity?.recycle()
            velocity = null
            eligible = false
            dragging = false
        }

        private fun isSurfaceZone(x: Float, y: Float): Boolean {
            // Every pixel of the fullscreen video is drag-eligible. A normal tap still reaches the
            // player because interception begins only after a vertical move crosses touch slop.
            return width <= 0 || height <= 0 ||
                (x >= 0f && x <= width.toFloat() && y >= 0f && y <= height.toFloat())
        }

        private fun applyTransform(dx: Float, dy: Float, p: Float) {
            val video = target ?: return
            video.animate().cancel()
            scrim?.animate()?.cancel()
            video.pivotX = width / 2f
            video.pivotY = height / 2f
            val scale = 1f - 0.22f * p
            video.scaleX = scale
            video.scaleY = scale
            video.translationX = dx * 0.55f
            video.translationY = dy * 0.82f
            video.alpha = 1f
            video.elevation = dp(YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
            if (p > 0.04f) {
                video.clipToOutline = true
                video.outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
                video.background = GradientDrawable().apply {
                    setColor(Color.BLACK)
                    cornerRadius = dpF(YoutubeParityMotion.MINI_CORNER_RADIUS_DP) * p
                }
            }
            // The live watch page is already rendered below this shell. Remove the black layer
            // quickly enough that it is visibly behind the finger instead of flashing in at exit.
            scrim?.alpha = (1f - 1.35f * p).coerceIn(0f, 1f)
        }

        private fun animateReset() {
            val video = target ?: return
            video.animate().cancel()
            scrim?.animate()?.cancel()
            scrim?.animate()?.alpha(1f)?.setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)?.start()
            video.animate()
                .scaleX(1f)
                .scaleY(1f)
                .translationX(0f)
                .translationY(0f)
                .alpha(1f)
                .setInterpolator(NativeFullscreenOverlay.watchEasing)
                .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
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
        private fun dpF(value: Int): Float = value * resources.displayMetrics.density

        companion object {
            private const val EXIT_FRACTION = 0.26f
            private const val EXIT_VELOCITY_PX_S = 920f
        }
    }
}
