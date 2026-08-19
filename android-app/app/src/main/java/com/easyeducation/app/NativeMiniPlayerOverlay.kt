package com.easyeducation.app

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.PathInterpolator
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
    private var expansionGeneration = 0
    private var expansionAnimator: ValueAnimator? = null

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
        handoff: NativeMiniPlayerHandoff? = null,
        onExpandToWatchPage: (() -> Unit)? = null,
    ) {
        if (host !== activity) dismiss(releasePlayer = false)
        expansionGeneration += 1
        expansionAnimator?.cancel()
        expansionAnimator = null
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

        val adoptedHandoff = handoff?.takeIf { candidate ->
            candidate.surface === NativeSharedPlayerSurface.current() &&
                candidate.surface.parent === candidate.shell &&
                candidate.shell.parent === contentRoot
        }
        if (handoff != null && adoptedHandoff == null) {
            (handoff.shell.parent as? ViewGroup)?.removeView(handoff.shell)
        }

        val shell = (adoptedHandoff?.shell ?: FrameLayout(activity)).apply {
            animate().cancel()
            elevation = dp(activity, YoutubeParityMotion.MINI_ELEVATION_DP).toFloat()
            clipChildren = true
            clipToOutline = true
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            background = miniBackground(activity, YoutubeParityMotion.MINI_CORNER_RADIUS_DP)
        }
        container = shell

        val surface = adoptedHandoff?.surface
            ?: NativeSharedPlayerSurface.detach()
            ?: NativeSharedPlayerSurface.obtain(activity)
        surface.bindPlayer(exoPlayer)
        surface.setTitle(title)
        surface.setLoading(false)
        NativeSharedPlayerSurface.setMiniPresentation(surface, true)
        playerSurface = surface
        if (surface.parent !== shell) {
            (surface.parent as? ViewGroup)?.removeView(surface)
            shell.addView(
                surface,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
            )
        }

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
            val exitY = ((root?.height ?: shell.rootView.height) + dp(activity, 8)).toFloat()
            shell.animate()
                .y(exitY)
                .alpha(0.92f)
                .setInterpolator(EXIT_EASING)
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

        val miniInset = dp(activity, YoutubeParityMotion.MINI_INSET_DP)
        val miniBottomInset = dp(activity, 82)
        fun targetX(): Float = (contentRoot.width - baseWidth - miniInset).coerceAtLeast(0).toFloat()
        fun targetY(): Float = (contentRoot.height - baseHeight - miniBottomInset).coerceAtLeast(0).toFloat()

        val initialBounds = (adoptedHandoff?.bounds ?: sourceBounds)?.takeUnless { it.isEmpty }
        val hasSourceBounds = initialBounds != null
        val transitionButtons = listOf(play, close, expand)
        if (hasSourceBounds) transitionButtons.forEach { it.alpha = 0f }
        if (initialBounds != null) {
            val rootLocation = IntArray(2)
            contentRoot.getLocationOnScreen(rootLocation)
            shell.pivotX = 0f
            shell.pivotY = 0f
            shell.x = (initialBounds.left - rootLocation[0]).toFloat()
            shell.y = (initialBounds.top - rootLocation[1]).toFloat()
            // Use the exact visual rectangle handed off by the drag shell. The old 1.75x clamp
            // made a full-width player jump to half its size for one frame before the morph began.
            shell.scaleX = initialBounds.width().toFloat() / baseWidth.coerceAtLeast(1)
            shell.scaleY = initialBounds.height().toFloat() / baseHeight.coerceAtLeast(1)
            shell.alpha = 1f
        } else {
            shell.x = targetX()
            shell.y = targetY()
            shell.alpha = 0f
            shell.scaleX = 0.82f
            shell.scaleY = 0.82f
        }

        val shellParams = FrameLayout.LayoutParams(baseWidth, baseHeight, Gravity.TOP or Gravity.START)
        if (shell.parent === contentRoot) {
            shell.layoutParams = shellParams
        } else {
            (shell.parent as? ViewGroup)?.removeView(shell)
            contentRoot.addView(shell, shellParams)
        }

        shell.postOnAnimation {
            if (inPipPresentation || container !== shell) return@postOnAnimation
            normalX = targetX()
            normalY = targetY()
            shell.animate()
                .x(normalX)
                .y(normalY)
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setInterpolator(WATCH_EASING)
                .setDuration(
                    if (hasSourceBounds) YoutubeParityMotion.WATCH_MIN_MAX_MS
                    else YoutubeParityMotion.WATCH_REVEAL_FROM_BOTTOM_MS,
                )
                .start()
            if (hasSourceBounds) {
                transitionButtons.forEach { button ->
                    button.animate()
                        .alpha(1f)
                        .setStartDelay((YoutubeParityMotion.WATCH_MIN_MAX_MS * 0.56f).toLong())
                        .setDuration(150L)
                        .start()
                }
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
        expansionGeneration += 1
        val generation = expansionGeneration
        PersistentNativePlayer.savePosition(activity)
        suppressNextPause = true
        val callback = expandCallback

        shell.animate().cancel()
        playButton?.isEnabled = false
        closeButton?.isEnabled = false
        expandButton?.isEnabled = false
        dragLayer?.isEnabled = false
        listOfNotNull(playButton, closeButton, expandButton).forEach { button ->
            button.animate().cancel()
            button.animate().alpha(0f).setDuration(120L).start()
        }

        if (callback != null) {
            // Build the real watch destination below the still-live mini shell first. The old flow
            // removed the player, then navigated, leaving a visible frame with no decoder surface.
            callback.invoke()
            waitForInlineTarget(
                activity = activity,
                shell = shell,
                exoPlayer = exoPlayer,
                classId = classId,
                generation = generation,
                startedAt = SystemClock.uptimeMillis(),
            )
            return
        }

        animateMiniToFullscreen(
            activity = activity,
            shell = shell,
            exoPlayer = exoPlayer,
            classId = classId,
            sourceUrl = sourceUrl,
            title = title,
            requestedHeight = requestedHeight,
            generation = generation,
        )
    }

    private fun waitForInlineTarget(
        activity: Activity,
        shell: FrameLayout,
        exoPlayer: ExoPlayer,
        classId: String,
        generation: Int,
        startedAt: Long,
    ) {
        if (generation != expansionGeneration || container !== shell || host !== activity) return
        val target = NativeInlineSurfaceRegistry.targetBounds(classId)
            ?.takeIf { it.width() > 0 && it.height() > 0 }
        if (target != null) {
            animateMiniToInline(activity, shell, exoPlayer, target, generation)
            return
        }
        if (SystemClock.uptimeMillis() - startedAt < EXPANSION_TARGET_WAIT_MS) {
            shell.postOnAnimation {
                waitForInlineTarget(activity, shell, exoPlayer, classId, generation, startedAt)
            }
            return
        }

        // A slow Compose frame should still expand smoothly. Move to the inline 16:9 slot and keep
        // the retained surface alive; restore() gets one final chance at animation completion.
        val currentRoot = root ?: return
        val rootLocation = IntArray(2)
        currentRoot.getLocationOnScreen(rootLocation)
        val width = currentRoot.width.coerceAtLeast(shell.width)
        val height = (width * 9f / 16f).toInt().coerceAtLeast(1)
        animateMiniToInline(
            activity,
            shell,
            exoPlayer,
            Rect(rootLocation[0], rootLocation[1], rootLocation[0] + width, rootLocation[1] + height),
            generation,
        )
    }

    private fun animateMiniToInline(
        activity: Activity,
        shell: FrameLayout,
        exoPlayer: ExoPlayer,
        targetBounds: Rect,
        generation: Int,
    ) {
        val currentRoot = root ?: return
        val rootLocation = IntArray(2)
        currentRoot.getLocationOnScreen(rootLocation)
        val startX = shell.x
        val startY = shell.y
        val startScaleX = shell.scaleX
        val startScaleY = shell.scaleY
        val targetX = (targetBounds.left - rootLocation[0]).toFloat()
        val targetY = (targetBounds.top - rootLocation[1]).toFloat()
        val targetScaleX = targetBounds.width().toFloat() / shell.width.coerceAtLeast(1)
        val targetScaleY = targetBounds.height().toFloat() / shell.height.coerceAtLeast(1)
        val background = miniBackground(activity, YoutubeParityMotion.MINI_CORNER_RADIUS_DP)
        val startRadius = dp(activity, YoutubeParityMotion.MINI_CORNER_RADIUS_DP).toFloat()

        shell.pivotX = 0f
        shell.pivotY = 0f
        shell.background = background
        expansionAnimator?.cancel()
        expansionAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = YoutubeParityMotion.WATCH_MIN_MAX_MS
            interpolator = WATCH_EASING
            addUpdateListener { animator ->
                if (generation != expansionGeneration || container !== shell) {
                    animator.cancel()
                    return@addUpdateListener
                }
                val p = animator.animatedValue as Float
                shell.x = lerp(startX, targetX, p)
                shell.y = lerp(startY, targetY, p)
                shell.scaleX = lerp(startScaleX, targetScaleX, p)
                shell.scaleY = lerp(startScaleY, targetScaleY, p)
                background.cornerRadius = startRadius * (1f - p)
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (generation != expansionGeneration || container !== shell) return
                    expansionAnimator = null
                    val restored = NativeInlineSurfaceRegistry.restore(exoPlayer)
                    if (restored) {
                        dismiss(releasePlayer = false)
                    } else {
                        // Keep sound and video policy safe even if the destination disappeared while
                        // expanding; never leave an invisible background player running.
                        dismiss(releasePlayer = true)
                    }
                }
            })
            start()
        }
    }

    private fun animateMiniToFullscreen(
        activity: Activity,
        shell: FrameLayout,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
        generation: Int,
    ) {
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
            .setInterpolator(WATCH_EASING)
            .setDuration(YoutubeParityMotion.WATCH_MIN_MAX_MS)
            .withEndAction {
                if (generation != expansionGeneration || container !== shell) return@withEndAction
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
        // Apply the full-video layout before MainActivity asks Android for PiP. Waiting for a later
        // traversal can let the system snapshot the Compose page instead of this topmost video.
        val widthSpec = View.MeasureSpec.makeMeasureSpec(currentRoot.width.coerceAtLeast(1), View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(currentRoot.height.coerceAtLeast(1), View.MeasureSpec.EXACTLY)
        shell.measure(widthSpec, heightSpec)
        shell.layout(0, 0, currentRoot.width.coerceAtLeast(1), currentRoot.height.coerceAtLeast(1))
        shell.bringToFront()
        shell.invalidate()
        currentRoot.invalidate()
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
        shell.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        shell.layout(0, 0, width, height)
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

    fun pipSourceRect(activity: Activity): Rect? {
        if (host !== activity || !inPipPresentation) return null
        val shell = container ?: return null
        val decor = activity.window.decorView
        val shellRect = Rect()
        if (!shell.getGlobalVisibleRect(shellRect) || shellRect.isEmpty) return null
        val decorLocation = IntArray(2)
        decor.getLocationOnScreen(decorLocation)
        shellRect.offset(-decorLocation[0], -decorLocation[1])
        return shellRect
    }

    fun abortPipAndPause(activity: Activity) {
        if (host !== activity) return
        if (inPipPresentation) exitPipPresentation()
        suppressNextPause = false
        player?.let { exo ->
            PersistentNativePlayer.savePosition(activity)
            exo.pause()
            playButton?.setImageResource(R.drawable.ic_player_play)
        }
    }

    fun isVisible(): Boolean = container != null
    fun isPipPresentation(): Boolean = inPipPresentation
    fun owns(exoPlayer: ExoPlayer): Boolean = player === exoPlayer && container != null
    fun isExpandingTo(exoPlayer: ExoPlayer, classId: String): Boolean =
        expanding && player === exoPlayer && container != null &&
            classId.isNotBlank() && PersistentNativePlayer.currentClassId() == classId

    fun dismiss(releasePlayer: Boolean = true) {
        expansionGeneration += 1
        expansionAnimator?.cancel()
        expansionAnimator = null
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
            shell.animate()
                .x(targetX)
                .y(targetY)
                .setInterpolator(WATCH_EASING)
                .setDuration(YoutubeParityMotion.WATCH_TRANSITION_MS)
                .start()
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

    private fun lerp(start: Float, end: Float, amount: Float): Float = start + (end - start) * amount

    private val WATCH_EASING = PathInterpolator(0.2f, 0f, 0f, 1f)
    private val EXIT_EASING = PathInterpolator(0.4f, 0f, 1f, 1f)
    private const val EXPANSION_TARGET_WAIT_MS = 620L
}
