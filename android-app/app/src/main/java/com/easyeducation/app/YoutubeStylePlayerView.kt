package com.easyeducation.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.widget.AppCompatImageButton
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlin.math.abs
import kotlin.math.max

/**
 * Easy Education's clean-room YouTube-style player surface. The full non-control video area owns
 * its gesture stream from ACTION_DOWN, preventing a parent LazyColumn from stealing a vertical drag
 * before the drag-to-miniplayer/fullscreen-exit interaction can begin.
 */
@UnstableApi
class YoutubeStylePlayerView @JvmOverloads constructor(
    context: Context,
    attrs: android.util.AttributeSet? = null,
) : FrameLayout(context, attrs) {

    var onBack: (() -> Unit)? = null
    var onFullscreen: (() -> Unit)? = null
    var onMinimize: (() -> Unit)? = null
    var onExitFullscreenGesture: (() -> Unit)? = null
    var onPrevious: (() -> Unit)? = null
    var onNext: (() -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val playerView: PlayerView
    private val controls: FrameLayout
    private val titleView: TextView
    private val timeText: TextView
    private val seekBar: SeekBar
    private val buffering: TextView
    private val quickSeekFeedback: YoutubeQuickSeekFeedbackView
    private val fastBadge: TextView
    private val speedBadge: TextView

    private val backButton: AppCompatImageButton
    private val settingsButton: AppCompatImageButton
    private val minimizeButton: AppCompatImageButton
    private val previousButton: AppCompatImageButton
    private val playPause: AppCompatImageButton
    private val nextButton: AppCompatImageButton
    private val fullscreenButton: AppCompatImageButton

    private var attachedPlayer: ExoPlayer? = null
    private var controlsVisible = true
    private var isSeeking = false
    private var selectedSpeed = 1f
    private var holdSpeedActive = false
    private var holdRestoreSpeed = 1f
    private var hasPrevious = false
    private var hasNext = false
    private var lastPlayingVisual: Boolean? = null
    private var fullscreenPresentation = false

    private var touchDownX = 0f
    private var touchDownY = 0f
    private var draggingDown = false
    private var dragProgress = 0f
    private var downOnControl = false
    private var surfaceGestureOwned = false
    private var longPressEligible = false
    private var minimizeCommitted = false
    private var rapidSeekSeconds = 0
    private var rapidSeekSide = 0
    private var lastRapidSeekAt = 0L
    private var controlsAnimationToken = 0
    private val resetRapidSeek = Runnable {
        rapidSeekSeconds = 0
        rapidSeekSide = 0
        lastRapidSeekAt = 0L
    }

    private val hideControls = Runnable { setControlsVisible(false) }
    private val progressUpdater = object : Runnable {
        override fun run() {
            val exo = attachedPlayer
            if (exo != null && !isSeeking) {
                val duration = max(0L, exo.duration.takeIf { it > 0L } ?: 0L)
                val position = max(0L, exo.currentPosition)
                val buffered = max(position, exo.bufferedPosition)
                seekBar.progress = if (duration > 0L) {
                    ((position * 1000L) / duration).toInt().coerceIn(0, 1000)
                } else 0
                seekBar.secondaryProgress = if (duration > 0L) {
                    ((buffered * 1000L) / duration).toInt().coerceIn(0, 1000)
                } else 0
                timeText.text = "${formatTime(position)} / ${formatTime(duration)}"
            }
            handler.postDelayed(this, 250L)
        }
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            updatePlayPause(isPlaying, animate = true)
            if (isPlaying) scheduleHide() else handler.removeCallbacks(hideControls)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            buffering.visibility = if (playbackState == Player.STATE_BUFFERING) View.VISIBLE else View.INVISIBLE
            if (playbackState == Player.STATE_ENDED) {
                setControlsVisible(true)
                updatePlayPause(false, animate = true)
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            buffering.text = "Playback error"
            buffering.visibility = View.VISIBLE
            setControlsVisible(true)
        }
    }

    private val gestureDetector = GestureDetector(
        context,
        object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (draggingDown || downOnControl) return false
                setControlsVisible(!controlsVisible)
                if (controlsVisible) scheduleHide()
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                if (draggingDown || downOnControl) return false
                performRapidSeek(e.x)
                return true
            }

            override fun onDoubleTapEvent(e: MotionEvent): Boolean {
                if (
                    e.actionMasked == MotionEvent.ACTION_DOWN &&
                    !draggingDown && !downOnControl &&
                    android.os.SystemClock.uptimeMillis() - lastRapidSeekAt > DOUBLE_TAP_DUPLICATE_GUARD_MS
                ) {
                    // After the initial double tap, every additional tap extends the seek by 10 s,
                    // matching the continuous YouTube quick-seek interaction.
                    performRapidSeek(e.x)
                }
                return true
            }

            override fun onLongPress(e: MotionEvent) {
                if (!surfaceGestureOwned || !longPressEligible || draggingDown || downOnControl) return
                val exo = attachedPlayer ?: return
                if (holdSpeedActive) return
                holdSpeedActive = true
                holdRestoreSpeed = exo.playbackParameters.speed
                val fast = max(2f, holdRestoreSpeed).coerceAtMost(4f)
                exo.setPlaybackSpeed(fast)
                fastBadge.text = "${speedLabel(fast)}  Hold"
                fastBadge.visibility = View.VISIBLE
                handler.removeCallbacks(hideControls)
            }
        },
    )

    init {
        setBackgroundColor(Color.BLACK)
        clipChildren = false
        clipToPadding = false
        isClickable = true

        playerView = PlayerView(context).apply {
            setBackgroundColor(Color.BLACK)
            useController = false
            keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        addView(playerView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        controls = FrameLayout(context)
        addView(controls, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val top = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(6), dp(6), dp(6))
            background = verticalShade(0xB8000000.toInt(), 0x00000000)
        }
        backButton = iconButton(R.drawable.ic_player_back, "Back").apply {
            setOnClickListener { pulse(this) { onBack?.invoke() } }
        }
        top.addView(backButton, LinearLayout.LayoutParams(dp(46), dp(46)))

        titleView = TextView(context).apply {
            textSize = 13.5f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(titleView, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginStart = dp(2) })

        speedBadge = pillText("1×").apply {
            textSize = 11.5f
            visibility = View.GONE
            setOnClickListener { showSpeedMenu(settingsButton) }
        }
        top.addView(speedBadge, LinearLayout.LayoutParams(dp(48), dp(30)).apply { marginEnd = dp(2) })

        settingsButton = iconButton(R.drawable.ic_player_settings, "Playback settings").apply {
            setOnClickListener { pulse(this) { showSpeedMenu(this) } }
        }
        top.addView(settingsButton, LinearLayout.LayoutParams(dp(44), dp(44)))

        minimizeButton = iconButton(R.drawable.ic_player_minimize, "Minimize player").apply {
            setOnClickListener { animateCommitMinimize() }
        }
        top.addView(minimizeButton, LinearLayout.LayoutParams(dp(44), dp(44)))
        controls.addView(top, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62), Gravity.TOP))

        val center = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        previousButton = iconButton(R.drawable.ic_player_previous, "Previous class", circle = true).apply {
            setOnClickListener {
                if (hasPrevious) pulse(this, strong = true) { onPrevious?.invoke() }
                showControlsTemporarily()
            }
        }
        playPause = iconButton(R.drawable.ic_player_play, "Play or pause", circle = true).apply {
            setOnClickListener {
                pulse(this, strong = true) {
                    attachedPlayer?.let { exo -> if (exo.isPlaying) exo.pause() else exo.play() }
                }
                showControlsTemporarily()
            }
        }
        nextButton = iconButton(R.drawable.ic_player_next, "Next class", circle = true).apply {
            setOnClickListener {
                if (hasNext) pulse(this, strong = true) { onNext?.invoke() }
                showControlsTemporarily()
            }
        }
        center.addView(previousButton, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginEnd = dp(18) })
        center.addView(playPause, LinearLayout.LayoutParams(dp(70), dp(70)))
        center.addView(nextButton, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginStart = dp(18) })
        controls.addView(center, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(76), Gravity.CENTER))

        buffering = pillText("Loading…").apply { visibility = View.INVISIBLE }
        controls.addView(buffering, LayoutParams(dp(118), dp(38), Gravity.CENTER).apply { topMargin = dp(96) })

        val bottom = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), 0, dp(4), dp(4))
            background = verticalShade(0x00000000, 0xC6000000.toInt())
        }
        seekBar = SeekBar(context).apply {
            max = 1000
            progressTintList = ColorStateList.valueOf(Color.rgb(255, 0, 0))
            secondaryProgressTintList = ColorStateList.valueOf(Color.argb(210, 220, 220, 220))
            progressBackgroundTintList = ColorStateList.valueOf(Color.argb(145, 120, 120, 120))
            thumbTintList = ColorStateList.valueOf(Color.rgb(255, 0, 0))
            setPadding(0, 0, 0, 0)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(seekBar: SeekBar?) {
                    isSeeking = true
                    handler.removeCallbacks(hideControls)
                }

                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val duration = attachedPlayer?.duration?.takeIf { it > 0L } ?: return
                    val target = duration * progress / 1000L
                    timeText.text = "${formatTime(target)} / ${formatTime(duration)}"
                }

                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    val exo = attachedPlayer
                    val duration = exo?.duration?.takeIf { it > 0L } ?: 0L
                    if (exo != null && duration > 0L) exo.seekTo(duration * (seekBar?.progress ?: 0) / 1000L)
                    isSeeking = false
                    showControlsTemporarily()
                }
            })
        }
        bottom.addView(seekBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)))

        val bottomRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        timeText = TextView(context).apply {
            text = "0:00 / 0:00"
            textSize = 12f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }
        bottomRow.addView(timeText, LinearLayout.LayoutParams(0, dp(38), 1f))
        fullscreenButton = iconButton(R.drawable.ic_player_fullscreen, "Full screen").apply {
            setOnClickListener { pulse(this, strong = true) { onFullscreen?.invoke() } }
        }
        bottomRow.addView(fullscreenButton, LinearLayout.LayoutParams(dp(50), dp(40)))
        bottom.addView(bottomRow)
        controls.addView(bottom, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(72), Gravity.BOTTOM))

        quickSeekFeedback = YoutubeQuickSeekFeedbackView(context).also {
            addView(it, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        fastBadge = pillText("2×").apply { visibility = View.INVISIBLE }
        addView(fastBadge, LayoutParams(dp(116), dp(40), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(22) })

        selectedSpeed = context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getFloat(SPEED_KEY, 1f)
            .coerceIn(0.25f, 4f)
        updateSpeedBadge()
        setNavigationAvailability(false, false)
    }

    /**
     * Non-control touches are consumed here from ACTION_DOWN. This is intentionally before child
     * dispatch/interception: Compose LazyColumn otherwise starts a vertical scroll and cancels the
     * player's later MOVE events before a drag-to-miniplayer threshold can ever be reached.
     */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchDownX = ev.x
                touchDownY = ev.y
                draggingDown = false
                dragProgress = 0f
                minimizeCommitted = false
                // Hidden chrome must not keep owning its old child hit boxes. In particular, the
                // invisible play/pause button sits in the middle of the video; treating that child
                // as interactive is why side taps revealed controls while a centre tap did nothing.
                downOnControl = controlsVisible &&
                    controls.visibility == View.VISIBLE &&
                    interactiveControls().any { hit(it, ev.rawX, ev.rawY) }
                surfaceGestureOwned = !downOnControl && !isSeeking
                longPressEligible = surfaceGestureOwned
                if (surfaceGestureOwned) {
                    parent?.requestDisallowInterceptTouchEvent(true)
                    gestureDetector.onTouchEvent(ev)
                    return true
                }
            }

            MotionEvent.ACTION_MOVE -> if (surfaceGestureOwned) {
                parent?.requestDisallowInterceptTouchEvent(true)
                val dx = ev.x - touchDownX
                val dy = ev.y - touchDownY
                if (longPressEligible && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                    longPressEligible = false
                    cancelGestureDetector(ev)
                    if (holdSpeedActive) finishHoldSpeed()
                }
                if (!draggingDown && dy > touchSlop && abs(dy) > abs(dx) * 1.05f) {
                    draggingDown = true
                    handler.removeCallbacks(hideControls)
                }
                if (draggingDown) {
                    val dragY = dy.coerceAtLeast(0f)
                    val denominator = height.coerceAtLeast(dp(180)) *
                        if (fullscreenPresentation) 0.58f else 0.70f
                    dragProgress = (dragY / denominator).coerceIn(0f, 1f)
                    applyDragTransform(dragY, dragProgress)
                } else {
                    if (longPressEligible) gestureDetector.onTouchEvent(ev)
                }
                return true
            }

            MotionEvent.ACTION_UP -> if (surfaceGestureOwned) {
                if (longPressEligible) gestureDetector.onTouchEvent(ev)
                longPressEligible = false
                if (holdSpeedActive) finishHoldSpeed()
                parent?.requestDisallowInterceptTouchEvent(false)
                surfaceGestureOwned = false
                if (draggingDown) {
                    val commit = dragProgress >= if (fullscreenPresentation) FULLSCREEN_EXIT_FRACTION else MINIMIZE_COMMIT_FRACTION
                    draggingDown = false
                    if (commit) animateCommitMinimize() else animateResetMinimize()
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> if (surfaceGestureOwned) {
                cancelGestureDetector(ev)
                longPressEligible = false
                if (holdSpeedActive) finishHoldSpeed()
                parent?.requestDisallowInterceptTouchEvent(false)
                surfaceGestureOwned = false
                if (draggingDown) animateResetMinimize()
                draggingDown = false
                return true
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = false

    /**
     * A presentation parent calls this before it reparents the view. Waiting for Android's deferred
     * child CANCEL is not sufficient because the detach can happen inside the parent's intercept
     * pass; GestureDetector's long-press callback could otherwise survive and enable 2x mid-drag.
     */
    fun cancelPendingSurfaceGesture() {
        val now = android.os.SystemClock.uptimeMillis()
        MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, touchDownX, touchDownY, 0).also { cancel ->
            gestureDetector.onTouchEvent(cancel)
            cancel.recycle()
        }
        longPressEligible = false
        if (holdSpeedActive) finishHoldSpeed()
        surfaceGestureOwned = false
        draggingDown = false
        dragProgress = 0f
        parent?.requestDisallowInterceptTouchEvent(false)
    }

    private fun cancelGestureDetector(source: MotionEvent) {
        MotionEvent.obtain(source).also { cancel ->
            cancel.action = MotionEvent.ACTION_CANCEL
            gestureDetector.onTouchEvent(cancel)
            cancel.recycle()
        }
    }

    fun bindPlayer(player: ExoPlayer?) {
        if (attachedPlayer === player) return
        attachedPlayer?.removeListener(listener)
        attachedPlayer = player
        playerView.player = player
        lastPlayingVisual = null
        player?.let {
            it.addListener(listener)
            it.setPlaybackSpeed(selectedSpeed)
            updatePlayPause(it.isPlaying, animate = false)
        }
        handler.removeCallbacks(progressUpdater)
        handler.post(progressUpdater)
    }

    fun setTitle(title: String) {
        titleView.text = title
        titleView.visibility = if (title.isBlank()) View.INVISIBLE else View.VISIBLE
    }

    fun setLoading(value: Boolean) {
        buffering.text = "Loading…"
        buffering.visibility = if (value) View.VISIBLE else View.INVISIBLE
    }

    fun setFullscreenPresentation(value: Boolean) {
        fullscreenPresentation = value
        fullscreenButton.visibility = if (value) View.INVISIBLE else View.VISIBLE
        minimizeButton.contentDescription = if (value) "Exit full screen" else "Minimize player"
        resetMinimizeImmediately()
    }

    fun setNavigationAvailability(previous: Boolean, next: Boolean) {
        hasPrevious = previous
        hasNext = next
        previousButton.isEnabled = previous
        nextButton.isEnabled = next
        previousButton.alpha = if (previous) 1f else 0.33f
        nextButton.alpha = if (next) 1f else 0.33f
    }

    private fun interactiveControls(): List<View> = listOf(
        backButton,
        settingsButton,
        minimizeButton,
        previousButton,
        playPause,
        nextButton,
        seekBar,
        fullscreenButton,
        speedBadge,
    )

    private fun hit(view: View, rawX: Float, rawY: Float): Boolean {
        if (!view.isEnabled || view.width <= 0 || view.height <= 0 || !isEffectivelyVisible(view)) return false
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        return rawX >= location[0] && rawX <= location[0] + view.width &&
            rawY >= location[1] && rawY <= location[1] + view.height
    }

    private fun isEffectivelyVisible(view: View): Boolean {
        var current: View? = view
        while (current != null && current !== this) {
            if (current.visibility != View.VISIBLE) return false
            current = current.parent as? View
        }
        return current === this
    }

    private fun applyDragTransform(dy: Float, progress: Float) {
        if (fullscreenPresentation) {
            val scale = 1f - 0.14f * progress
            pivotX = width / 2f
            pivotY = height / 2f
            scaleX = scale
            scaleY = scale
            translationX = 0f
            translationY = dy * 0.56f
            alpha = 1f - 0.18f * progress
            controls.alpha = (1f - progress * 0.92f).coerceAtLeast(0.05f)
            elevation = dp(12).toFloat() * progress
            return
        }
        val scale = 1f - 0.31f * progress
        pivotX = width.toFloat()
        pivotY = height.toFloat()
        scaleX = scale
        scaleY = scale
        translationY = dy * 0.68f
        translationX = width * 0.12f * progress
        controls.alpha = (1f - progress * 0.90f).coerceAtLeast(0.08f)
        elevation = dp(10).toFloat() * progress
    }

    private fun animateCommitMinimize() {
        if (minimizeCommitted) return
        minimizeCommitted = true
        handler.removeCallbacks(hideControls)
        animate().cancel()
        controls.animate().alpha(0.04f).setDuration(90L).start()
        if (fullscreenPresentation) {
            animate()
                .scaleX(0.84f)
                .scaleY(0.84f)
                .translationX(0f)
                .translationY(height * 0.22f)
                .alpha(0.50f)
                .setInterpolator(DecelerateInterpolator())
                .setDuration(165L)
                .withEndAction {
                    onExitFullscreenGesture?.invoke() ?: onBack?.invoke()
                    handler.postDelayed({ resetMinimizeImmediately() }, 80L)
                }
                .start()
            return
        }
        animate()
            .scaleX(0.66f)
            .scaleY(0.66f)
            .translationX(width * 0.16f)
            .translationY(height * 0.34f)
            .alpha(0.92f)
            .setInterpolator(DecelerateInterpolator())
            .setDuration(150L)
            .withEndAction {
                onMinimize?.invoke()
                handler.postDelayed({ resetMinimizeImmediately() }, 100L)
            }
            .start()
    }

    private fun animateResetMinimize() {
        minimizeCommitted = false
        animate().cancel()
        controls.animate().alpha(1f).setDuration(150L).start()
        animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .alpha(1f)
            .setInterpolator(OvershootInterpolator(0.35f))
            .setDuration(230L)
            .withEndAction { resetMinimizeImmediately() }
            .start()
    }

    private fun resetMinimizeImmediately() {
        pivotX = width / 2f
        pivotY = height / 2f
        scaleX = 1f
        scaleY = 1f
        translationX = 0f
        translationY = 0f
        alpha = 1f
        elevation = 0f
        controls.alpha = 1f
        draggingDown = false
        dragProgress = 0f
        minimizeCommitted = false
    }

    private fun pulse(view: View, strong: Boolean = false, action: () -> Unit) {
        val target = if (strong) 0.80f else 0.88f
        view.animate().cancel()
        view.animate()
            .scaleX(target)
            .scaleY(target)
            .alpha(0.64f)
            .setDuration(58L)
            .withEndAction {
                action()
                view.animate()
                    .scaleX(1f)
                    .scaleY(1f)
                    .alpha(if (view.isEnabled) 1f else 0.33f)
                    .setInterpolator(OvershootInterpolator(0.55f))
                    .setDuration(145L)
                    .start()
            }
            .start()
    }

    private fun seekBy(deltaMs: Long) {
        val exo = attachedPlayer ?: return
        val duration = exo.duration.takeIf { it > 0L } ?: Long.MAX_VALUE
        exo.seekTo((exo.currentPosition + deltaMs).coerceIn(0L, duration))
    }

    private fun performRapidSeek(x: Float) {
        handler.removeCallbacks(hideControls)
        val side = if (x < width / 2f) -1 else 1
        val now = android.os.SystemClock.uptimeMillis()
        rapidSeekSeconds = if (side == rapidSeekSide && now - lastRapidSeekAt <= RAPID_SEEK_CHAIN_MS) {
            if (rapidSeekSeconds > Int.MAX_VALUE - 10) Int.MAX_VALUE else rapidSeekSeconds + 10
        } else {
            10
        }
        rapidSeekSide = side
        lastRapidSeekAt = now
        seekBy(side * 10_000L)
        showRapidSeek(side, rapidSeekSeconds)
    }

    private fun showRapidSeek(side: Int, seconds: Int) {
        quickSeekFeedback.show(side, seconds)
        handler.removeCallbacks(resetRapidSeek)
        handler.postDelayed(resetRapidSeek, RAPID_SEEK_CHAIN_MS)
    }

    private fun finishHoldSpeed() {
        if (!holdSpeedActive) return
        holdSpeedActive = false
        attachedPlayer?.setPlaybackSpeed(holdRestoreSpeed)
        fastBadge.visibility = View.INVISIBLE
        showControlsTemporarily()
    }

    private fun showSpeedMenu(anchor: View) {
        handler.removeCallbacks(hideControls)
        val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f, 3.5f, 4f)
        PopupMenu(context, anchor).apply {
            speeds.forEachIndexed { index, speed ->
                val marker = if (speed == selectedSpeed) "✓ " else ""
                menu.add(0, index, index, "$marker${speedLabel(speed)}")
            }
            setOnMenuItemClickListener { item ->
                selectedSpeed = speeds[item.itemId]
                context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                    .edit().putFloat(SPEED_KEY, selectedSpeed).apply()
                attachedPlayer?.setPlaybackSpeed(selectedSpeed)
                updateSpeedBadge()
                showControlsTemporarily()
                true
            }
            setOnDismissListener { showControlsTemporarily() }
            show()
        }
    }

    private fun updateSpeedBadge() {
        speedBadge.text = speedLabel(selectedSpeed)
        speedBadge.visibility = if (selectedSpeed == 1f) View.GONE else View.VISIBLE
    }

    private fun updatePlayPause(isPlaying: Boolean, animate: Boolean) {
        if (lastPlayingVisual == isPlaying) return
        lastPlayingVisual = isPlaying
        val icon = if (isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play
        playPause.contentDescription = if (isPlaying) "Pause" else "Play"
        if (!animate || !isAttachedToWindow) {
            playPause.setImageResource(icon)
            playPause.scaleX = 1f
            playPause.scaleY = 1f
            playPause.alpha = 1f
            return
        }
        playPause.animate().cancel()
        // Swap the vector before animating. Fading the old drawable almost to transparent before
        // the swap made a fast play/pause transition look like a blank button on some devices.
        playPause.setImageResource(icon)
        playPause.rotation = if (isPlaying) -5f else 5f
        playPause.scaleX = 0.78f
        playPause.scaleY = 0.78f
        playPause.alpha = 1f
        playPause.animate()
            .rotation(0f)
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setInterpolator(OvershootInterpolator(0.65f))
            .setDuration(175L)
            .start()
    }

    private fun showControlsTemporarily() {
        setControlsVisible(true)
        scheduleHide()
    }

    private fun scheduleHide() {
        handler.removeCallbacks(hideControls)
        if (attachedPlayer?.isPlaying == true) handler.postDelayed(hideControls, 2800L)
    }

    private fun setControlsVisible(visible: Boolean) {
        if (controlsVisible == visible &&
            ((visible && controls.visibility == View.VISIBLE && controls.alpha >= 0.99f) ||
                (!visible && controls.visibility == View.INVISIBLE))
        ) return
        controlsVisible = visible
        val token = ++controlsAnimationToken
        controls.animate().cancel()
        if (visible) {
            if (controls.visibility != View.VISIBLE) {
                controls.alpha = 0f
                controls.scaleX = 0.985f
                controls.scaleY = 0.985f
                controls.visibility = View.VISIBLE
            }
            controls.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setInterpolator(DecelerateInterpolator(1.55f))
                .setDuration(230L)
                .withEndAction {
                    if (token == controlsAnimationToken) {
                        controls.alpha = 1f
                        controls.scaleX = 1f
                        controls.scaleY = 1f
                    }
                }
                .start()
        } else {
            handler.removeCallbacks(hideControls)
            controls.animate()
                .alpha(0f)
                .scaleX(1.008f)
                .scaleY(1.008f)
                .setInterpolator(DecelerateInterpolator())
                .setDuration(190L)
                .withEndAction {
                    if (token == controlsAnimationToken && !controlsVisible) {
                        controls.visibility = View.INVISIBLE
                        controls.scaleX = 1f
                        controls.scaleY = 1f
                    }
                }
                .start()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        handler.removeCallbacks(progressUpdater)
        handler.post(progressUpdater)
    }

    override fun onDetachedFromWindow() {
        parent?.requestDisallowInterceptTouchEvent(false)
        handler.removeCallbacks(progressUpdater)
        handler.removeCallbacks(hideControls)
        handler.removeCallbacks(resetRapidSeek)
        quickSeekFeedback.hideImmediately()
        super.onDetachedFromWindow()
    }

    private fun iconButton(drawable: Int, description: String, circle: Boolean = false) =
        AppCompatImageButton(context).apply {
            setImageResource(drawable)
            contentDescription = description
            setBackgroundColor(Color.TRANSPARENT)
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(if (circle) 13 else 11), dp(if (circle) 13 else 11), dp(if (circle) 13 else 11), dp(if (circle) 13 else 11))
            if (circle) background = roundedBackground(Color.argb(135, 15, 15, 15), 100f)
        }

    private fun pillText(value: String) = TextView(context).apply {
        text = value
        textSize = 13f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setTypeface(typeface, Typeface.BOLD)
        background = roundedBackground(Color.argb(165, 28, 28, 28), 40f)
    }

    private fun seekHint() = TextView(context).apply {
        gravity = Gravity.CENTER
        textSize = 14f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        background = roundedBackground(Color.argb(175, 20, 20, 20), 40f)
        visibility = View.INVISIBLE
    }

    private fun roundedBackground(color: Int, radiusDp: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp.toInt()).toFloat()
    }

    private fun verticalShade(start: Int, end: Int) = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(start, end),
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun formatTime(ms: Long): String {
        val totalSeconds = (ms / 1000L).coerceAtLeast(0L)
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0L) "%d:%02d:%02d".format(hours, minutes, seconds)
        else "%d:%02d".format(minutes, seconds)
    }

    private fun speedLabel(speed: Float): String = if (speed % 1f == 0f) "${speed.toInt()}×" else "${speed}×"

    companion object {
        private const val PLAYER_PREFS = "native_player_positions_v2"
        private const val SPEED_KEY = "youtube_style_speed"
        private const val MINIMIZE_COMMIT_FRACTION = 0.24f
        private const val FULLSCREEN_EXIT_FRACTION = 0.22f
        private const val RAPID_SEEK_CHAIN_MS = 780L
        private const val DOUBLE_TAP_DUPLICATE_GUARD_MS = 80L
    }
}
