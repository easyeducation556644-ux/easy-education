package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.appcompat.widget.AppCompatImageButton
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.google.firebase.auth.FirebaseAuth
import kotlin.math.abs
import kotlin.math.min

/**
 * Movable/resizable in-app mini-player and Android PiP staging surface. The exact same
 * YoutubeStylePlayerView used by the watch page/fullscreen is reparented here; only the shell and
 * controls change. Dragging never opens the class. Play/pause, close and expand are explicit.
 */
@UnstableApi
object NativeMiniPlayerOverlay {
    private var host: Activity? = null
    private var root: FrameLayout? = null
    private var container: FrameLayout? = null
    private var playerSurface: YoutubeStylePlayerView? = null
    private var player: ExoPlayer? = null
    private var lifecycleOwner: LifecycleOwner? = null
    private var lifecycleObserver: DefaultLifecycleObserver? = null
    private var authListener: FirebaseAuth.AuthStateListener? = null
    private var playerListener: Player.Listener? = null
    private var expandCallback: (() -> Unit)? = null
    private var suppressNextPause = false
    private var expanding = false
    private var inPipPresentation = false

    private var playButton: AppCompatImageButton? = null
    private var closeButton: AppCompatImageButton? = null
    private var expandButton: AppCompatImageButton? = null
    private var dragLayer: View? = null

    private var normalWidth = 0
    private var normalHeight = 0
    private var normalX = 0f
    private var normalY = 0f

    fun show(
        activity: Activity,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
        sourceBounds: Rect? = null,
        onExpandToWatchPage: (() -> Unit)? = null,
    ) {
        if (host !== activity) dismiss(releasePlayer = false)
        removeContainerOnly()
        detachPlayerListener()

        host = activity
        player = exoPlayer
        expandCallback = onExpandToWatchPage
        suppressNextPause = false
        expanding = false
        inPipPresentation = false

        val contentRoot = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        root = contentRoot
        val baseWidth = dp(activity, if (activity.resources.configuration.smallestScreenWidthDp >= 600) 340 else 252)
        val baseHeight = (baseWidth * 9f / 16f).toInt()
        normalWidth = baseWidth
        normalHeight = baseHeight

        val shell = FrameLayout(activity).apply {
            elevation = dp(activity, YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
            clipToOutline = true
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            background = miniBackground(activity, YoutubeParityMotion.MINI_CORNER_RADIUS_DP)
        }
        container = shell

        val surface = NativeSharedPlayerSurface.detach() ?: NativeSharedPlayerSurface.obtain(activity)
        surface.bindPlayer(exoPlayer)
        surface.setTitle(title)
        surface.setLoading(false)
        NativeSharedPlayerSurface.setMiniPresentation(surface, true)
        playerSurface = surface
        shell.addView(
            surface,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        val gestureLayer = View(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            contentDescription = "Move or resize mini player"
        }
        dragLayer = gestureLayer
        shell.addView(
            gestureLayer,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        val play = miniButton(
            activity,
            if (exoPlayer.isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play,
            "Play or pause",
        )
        playButton = play
        shell.addView(play, FrameLayout.LayoutParams(dp(activity, 50), dp(activity, 50), Gravity.CENTER))

        val close = miniButton(activity, R.drawable.ic_player_close, "Close mini player")
        closeButton = close
        shell.addView(
            close,
            FrameLayout.LayoutParams(dp(activity, 40), dp(activity, 40), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(activity, 4)
                marginEnd = dp(activity, 4)
            },
        )

        val expand = miniButton(activity, R.drawable.ic_player_fullscreen, "Open class player")
        expandButton = expand
        shell.addView(
            expand,
            FrameLayout.LayoutParams(dp(activity, 42), dp(activity, 42), Gravity.BOTTOM or Gravity.END).apply {
                bottomMargin = dp(activity, 4)
                marginEnd = dp(activity, 4)
            },
        )

        play.setOnClickListener { if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play() }
        close.setOnClickListener {
            shell.animate().cancel()
            shell.animate()
                .alpha(0f)
                .scaleX(0.82f)
                .scaleY(0.82f)
                .setDuration(YoutubeParityMotion.WATCH_DOWN_OUT_MS)
                .withEndAction { dismiss(releasePlayer = true) }
                .start()
        }
        expand.setOnClickListener { expandExplicitly(activity, shell, exoPlayer, classId, sourceUrl, title, requestedHeight) }

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                play.animate().cancel()
                play.animate().scaleX(0.82f).scaleY(0.82f).setDuration(55L).withEndAction {
                    play.setImageResource(if (isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play)
                    play.animate().scaleX(1f).scaleY(1f).setDuration(105L).start()
                }.start()
            }
        }
        playerListener = listener
        exoPlayer.addListener(listener)

        val touchSlop = ViewConfiguration.get(activity).scaledTouchSlop
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0f
        var startY = 0f
        var dragging = false

        val scaler = ScaleGestureDetector(
            activity,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    val currentShell = container ?: return false
                    val currentRoot = root ?: return false
                    val currentWidth = currentShell.width.takeIf { it > 0 } ?: normalWidth
                    val minWidth = dp(activity, 176)
                    val maxWidth = min(
                        currentRoot.width - dp(activity, YoutubeParityMotion.MINI_INSET_DP),
                        dp(activity, YoutubeParityMotion.MINI_MAX_SIZE_DP),
                    ).coerceAtLeast(minWidth)
                    val targetWidth = (currentWidth * detector.scaleFactor).toInt().coerceIn(minWidth, maxWidth)
                    val targetHeight = (targetWidth * 9f / 16f).toInt()
                    val lp = currentShell.layoutParams as FrameLayout.LayoutParams
                    lp.width = targetWidth
                    lp.height = targetHeight
                    currentShell.layoutParams = lp
                    normalWidth = targetWidth
                    normalHeight = targetHeight
                    clampInsideRoot(currentRoot, currentShell)
                    return true
                }
            },
        )

        gestureLayer.setOnTouchListener { view, event ->
            scaler.onTouchEvent(event)
            if (scaler.isInProgress) return@setOnTouchListener true

            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = shell.x
                    startY = shell.y
                    dragging = false
                    shell.animate().cancel()
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
                    if (dragging) {
                        val maxX = (contentRoot.width - shell.width).coerceAtLeast(0).toFloat()
                        val maxY = (contentRoot.height - shell.height).coerceAtLeast(0).toFloat()
                        shell.x = (startX + dx).coerceIn(0f, maxX)
                        shell.y = (startY + dy).coerceIn(0f, maxY)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!dragging) view.performClick()
                    clampInsideRoot(contentRoot, shell, animate = true)
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    clampInsideRoot(contentRoot, shell, animate = true)
                    true
                }

                else -> true
            }
        }

        contentRoot.addView(
            shell,
            FrameLayout.LayoutParams(baseWidth, baseHeight, Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = dp(activity, YoutubeParityMotion.MINI_INSET_DP)
                bottomMargin = dp(activity, 82)
            },
        )

        shell.post {
            normalX = shell.x
            normalY = shell.y
            if (sourceBounds != null && !sourceBounds.isEmpty) {
                val rootLocation = IntArray(2)
                contentRoot.getLocationOnScreen(rootLocation)
                val sourceX = (sourceBounds.left - rootLocation[0]).toFloat()
                val sourceY = (sourceBounds.top - rootLocation[1]).toFloat()
                val sourceScale = min(
                    sourceBounds.width().toFloat() / shell.width.coerceAtLeast(1),
                    sourceBounds.height().toFloat() / shell.height.coerceAtLeast(1),
                ).coerceIn(0.60f, 1.75f)
                val targetX = shell.x
                val targetY = shell.y
                shell.pivotX = 0f
                shell.pivotY = 0f
                shell.x = sourceX
                shell.y = sourceY
                shell.scaleX = sourceScale
                shell.scaleY = sourceScale
                shell.animate()
                    .x(targetX)
                    .y(targetY)
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(YoutubeParityMotion.WATCH_MIN_MAX_MS)
                    .start()
            } else {
                shell.alpha = 0f
                shell.scaleX = 0.82f
                shell.scaleY = 0.82f
                shell.animate()
                    .alpha(1f)
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(YoutubeParityMotion.WATCH_REVEAL_FROM_BOTTOM_MS)
                    .start()
            }
        }

        play.bringToFront()
        close.bringToFront()
        expand.bringToFront()
        attachLifecycle(activity, exoPlayer, play)
        attachAuthListener(exoPlayer)
    }

    private fun expandExplicitly(
        activity: Activity,
        shell: FrameLayout,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
    ) {
        if (expanding) return
        expanding = true
        PersistentNativePlayer.savePosition(activity)
        suppressNextPause = true
        val callback = expandCallback

        shell.animate().cancel()
        val rootWidth = root?.width?.takeIf { it > 0 } ?: shell.width
        val targetScale = (rootWidth.toFloat() / shell.width.coerceAtLeast(1)).coerceAtLeast(1f)
        shell.pivotX = 0f
        shell.pivotY = 0f
        shell.animate()
            .x(0f)
            .y(0f)
            .scaleX(targetScale)
            .scaleY(targetScale)
            .alpha(1f)
            .setDuration(YoutubeParityMotion.WATCH_MIN_MAX_MS)
            .withEndAction {
                if (callback != null) {
                    dismiss(releasePlayer = false)
                    callback.invoke()
                } else {
                    val bounds = globalBounds(shell)
                    dismiss(releasePlayer = false)
                    NativeFullscreenOverlay.show(
                        activity = activity,
                        exoPlayer = exoPlayer,
                        classId = classId,
                        sourceUrl = sourceUrl,
                        title = title,
                        requestedHeight = requestedHeight,
                        sourceBounds = bounds,
                    ) { }
                }
            }
            .start()
    }

    fun enterPipPresentation(): Boolean {
        val activity = host ?: return false
        val currentRoot = root ?: return false
        val shell = container ?: return false
        if (inPipPresentation) return true

        suppressNextPause = true
        inPipPresentation = true
        normalX = shell.x
        normalY = shell.y
        normalWidth = shell.width.takeIf { it > 0 } ?: normalWidth
        normalHeight = shell.height.takeIf { it > 0 } ?: normalHeight

        playButton?.visibility = View.GONE
        closeButton?.visibility = View.GONE
        expandButton?.visibility = View.GONE
        dragLayer?.isEnabled = false
        shell.background = miniBackground(activity, 0)
        shell.animate().cancel()
        shell.x = 0f
        shell.y = 0f
        shell.scaleX = 1f
        shell.scaleY = 1f
        shell.alpha = 1f
        shell.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER,
        )
        shell.requestLayout()
        shell.bringToFront()
        currentRoot.requestLayout()
        return true
    }

    fun exitPipPresentation() {
        val activity = host ?: return
        val currentRoot = root ?: return
        val shell = container ?: return
        if (!inPipPresentation) return
        inPipPresentation = false

        val width = normalWidth.coerceAtLeast(dp(activity, 176))
        val height = normalHeight.coerceAtLeast((width * 9f / 16f).toInt())
        shell.layoutParams = FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.START)
        shell.background = miniBackground(activity, YoutubeParityMotion.MINI_CORNER_RADIUS_DP)
        shell.x = normalX
        shell.y = normalY
        clampInsideRoot(currentRoot, shell)
        playButton?.visibility = View.VISIBLE
        closeButton?.visibility = View.VISIBLE
        expandButton?.visibility = View.VISIBLE
        dragLayer?.isEnabled = true
        shell.bringToFront()
    }

    fun ensureForPip(activity: Activity): Boolean {
        val classId = PersistentNativePlayer.currentClassId()
        val sourceUrl = PersistentNativePlayer.currentSourceUrl()
        if (classId.isBlank() || sourceUrl.isBlank()) return false
        val exo = PersistentNativePlayer.player(activity)
        if (exo.mediaItemCount == 0) return false

        if (host !== activity || container == null || player !== exo) {
            show(
                activity = activity,
                exoPlayer = exo,
                classId = classId,
                sourceUrl = sourceUrl,
                title = "",
                requestedHeight = PersistentNativePlayer.currentHeight().takeIf { it > 0 } ?: 480,
                sourceBounds = NativeInlineSurfaceRegistry.targetBounds(),
                onExpandToWatchPage = null,
            )
        }
        return enterPipPresentation()
    }

    fun isVisible(): Boolean = container != null
    fun isPipPresentation(): Boolean = inPipPresentation
    fun owns(exoPlayer: ExoPlayer): Boolean = player === exoPlayer && container != null

    fun dismiss(releasePlayer: Boolean = true) {
        val currentHost = host
        val currentPlayer = player
        detachPlayerListener()
        removeContainerOnly()
        player = null
        expandCallback = null
        expanding = false
        inPipPresentation = false
        detachLifecycle()
        detachAuthListener()
        host = null
        root = null
        if (releasePlayer && currentHost != null && currentPlayer != null) {
            PersistentNativePlayer.stopIfOwned(currentHost, currentPlayer)
        }
    }

    private fun attachLifecycle(activity: Activity, exoPlayer: ExoPlayer, play: AppCompatImageButton) {
        detachLifecycle()
        val owner = activity as? LifecycleOwner ?: return
        val observer = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                if (player === exoPlayer && !suppressNextPause && !inPipPresentation) {
                    PersistentNativePlayer.savePosition(activity)
                    exoPlayer.pause()
                    play.setImageResource(R.drawable.ic_player_play)
                }
                suppressNextPause = false
            }

            override fun onDestroy(owner: LifecycleOwner) {
                if (host === activity) dismiss(releasePlayer = true)
            }
        }
        lifecycleOwner = owner
        lifecycleObserver = observer
        owner.lifecycle.addObserver(observer)
    }

    private fun attachAuthListener(exoPlayer: ExoPlayer) {
        detachAuthListener()
        val auth = FirebaseAuth.getInstance()
        val listener = FirebaseAuth.AuthStateListener { state ->
            if (state.currentUser == null && player === exoPlayer) dismiss(releasePlayer = true)
        }
        authListener = listener
        auth.addAuthStateListener(listener)
    }

    private fun detachPlayerListener() {
        val exo = player
        val listener = playerListener
        if (exo != null && listener != null) exo.removeListener(listener)
        playerListener = null
    }

    private fun detachAuthListener() {
        authListener?.let { FirebaseAuth.getInstance().removeAuthStateListener(it) }
        authListener = null
    }

    private fun detachLifecycle() {
        val owner = lifecycleOwner
        val observer = lifecycleObserver
        if (owner != null && observer != null) owner.lifecycle.removeObserver(observer)
        lifecycleOwner = null
        lifecycleObserver = null
    }

    private fun removeContainerOnly() {
        val shell = container
        val surface = playerSurface
        if (shell != null && surface?.parent === shell) shell.removeView(surface)
        playerSurface = null
        playButton = null
        closeButton = null
        expandButton = null
        dragLayer = null
        shell?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        container = null
    }

    private fun clampInsideRoot(root: FrameLayout, shell: FrameLayout, animate: Boolean = false) {
        val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
        val maxY = (root.height - shell.height).coerceAtLeast(0).toFloat()
        val targetX = shell.x.coerceIn(0f, maxX)
        val targetY = shell.y.coerceIn(0f, maxY)
        if (animate) {
            shell.animate().x(targetX).y(targetY).setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS).start()
        } else {
            shell.x = targetX
            shell.y = targetY
        }
    }

    private fun globalBounds(view: View): Rect {
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
    }

    private fun miniButton(context: Context, drawable: Int, description: String) = AppCompatImageButton(context).apply {
        setImageResource(drawable)
        contentDescription = description
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        setPadding(dp(context, 10), dp(context, 10), dp(context, 10), dp(context, 10))
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.argb(158, 8, 8, 8))
        }
    }

    private fun miniBackground(context: Context, radiusDp: Int) = GradientDrawable().apply {
        setColor(Color.BLACK)
        cornerRadius = dp(context, radiusDp).toFloat()
    }

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()
}
