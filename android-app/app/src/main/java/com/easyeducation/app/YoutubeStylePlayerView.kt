package com.easyeducation.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AttributeSet
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
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
 * Unified Easy Education player surface. Interaction and placement follow familiar YouTube mobile
 * conventions while the implementation, assets and media pipeline are native Easy Education code.
 */
@UnstableApi
class YoutubeStylePlayerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    var onBack: (() -> Unit)? = null
    var onFullscreen: (() -> Unit)? = null
    var onMinimize: (() -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())
    private val playerView: PlayerView
    private val controls: FrameLayout
    private val titleView: TextView
    private val playPause: AppCompatImageButton
    private val settingsButton: AppCompatImageButton
    private val speedBadge: TextView
    private val timeText: TextView
    private val seekBar: SeekBar
    private val buffering: TextView
    private val leftHint: TextView
    private val rightHint: TextView
    private val fastBadge: TextView

    private var attachedPlayer: ExoPlayer? = null
    private var controlsVisible = true
    private var isSeeking = false
    private var downX = 0f
    private var downY = 0f
    private var moved = false
    private var lastTapAt = 0L
    private var lastTapSide = 0
    private var rapidSeekSeconds = 0
    private var selectedSpeed = 1f
    private var holdSpeedActive = false
    private var holdRestoreSpeed = 1f
    private var minimizing = false
    private var minimizeProgress = 0f
    private var singleTapRunnable: Runnable? = null
    private var holdRunnable: Runnable? = null
    private var rapidResetRunnable: Runnable? = null

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
            updatePlayPause(isPlaying)
            if (isPlaying) scheduleHide() else handler.removeCallbacks(hideControls)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            buffering.visibility = if (playbackState == Player.STATE_BUFFERING) View.VISIBLE else View.INVISIBLE
            if (playbackState == Player.STATE_ENDED) {
                setControlsVisible(true)
                updatePlayPause(false)
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            buffering.text = "Playback error"
            buffering.visibility = View.VISIBLE
            setControlsVisible(true)
        }
    }

    init {
        setBackgroundColor(Color.BLACK)
        clipChildren = false
        clipToPadding = false

        playerView = PlayerView(context).apply {
            setBackgroundColor(Color.BLACK)
            useController = false
            keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        addView(
            playerView,
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        val gestureLayer = View(context).apply {
            isClickable = true
            isFocusable = true
            setBackgroundColor(Color.TRANSPARENT)
            setOnTouchListener { view, event -> handleTouch(view, event) }
        }
        addView(
            gestureLayer,
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        controls = FrameLayout(context)
        addView(controls, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val top = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(7), dp(7), dp(7))
            background = verticalShade(0xB5000000.toInt(), 0x00000000)
        }

        val back = iconButton(R.drawable.ic_player_back, "Back").apply {
            setOnClickListener { onBack?.invoke() }
        }
        top.addView(back, LinearLayout.LayoutParams(dp(46), dp(46)))

        titleView = TextView(context).apply {
            textSize = 14f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
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
            setOnClickListener { showSpeedMenu(this) }
        }
        top.addView(settingsButton, LinearLayout.LayoutParams(dp(44), dp(44)))

        val collapse = iconButton(R.drawable.ic_player_minimize, "Minimize player").apply {
            setOnClickListener { animateCommitMinimize() }
        }
        top.addView(collapse, LinearLayout.LayoutParams(dp(44), dp(44)))
        controls.addView(top, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62), Gravity.TOP))

        playPause = iconButton(R.drawable.ic_player_play, "Play or pause", circle = true).apply {
            setOnClickListener {
                attachedPlayer?.let { exo -> if (exo.isPlaying) exo.pause() else exo.play() }
                showControlsTemporarily()
            }
        }
        controls.addView(playPause, LayoutParams(dp(68), dp(68), Gravity.CENTER))

        buffering = pillText("Loading…").apply { visibility = View.INVISIBLE }
        controls.addView(
            buffering,
            LayoutParams(dp(118), dp(38), Gravity.CENTER).apply { topMargin = dp(92) },
        )

        val bottom = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, dp(6), dp(5))
            background = verticalShade(0x00000000, 0xC0000000.toInt())
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
                    if (exo != null && duration > 0L) {
                        exo.seekTo(duration * (seekBar?.progress ?: 0) / 1000L)
                    }
                    isSeeking = false
                    showControlsTemporarily()
                }
            })
        }
        bottom.addView(seekBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)))

        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        timeText = TextView(context).apply {
            text = "0:00 / 0:00"
            textSize = 12f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(timeText, LinearLayout.LayoutParams(0, dp(38), 1f))

        val fullscreen = iconButton(R.drawable.ic_player_fullscreen, "Full screen").apply {
            setOnClickListener { onFullscreen?.invoke() }
        }
        row.addView(fullscreen, LinearLayout.LayoutParams(dp(48), dp(38)))
        bottom.addView(row)
        controls.addView(bottom, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(74), Gravity.BOTTOM))

        leftHint = seekHint().also {
            addView(
                it,
                LayoutParams(dp(148), dp(72), Gravity.CENTER_VERTICAL or Gravity.START).apply {
                    marginStart = dp(24)
                },
            )
        }
        rightHint = seekHint().also {
            addView(
                it,
                LayoutParams(dp(148), dp(72), Gravity.CENTER_VERTICAL or Gravity.END).apply {
                    marginEnd = dp(24)
                },
            )
        }
        fastBadge = pillText("2×").apply { visibility = View.INVISIBLE }
        addView(
            fastBadge,
            LayoutParams(dp(110), dp(40), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
                topMargin = dp(24)
            },
        )

        selectedSpeed = context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getFloat(SPEED_KEY, 1f)
            .coerceIn(0.25f, 4f)
        updateSpeedBadge()
    }

    fun bindPlayer(player: ExoPlayer?) {
        if (attachedPlayer === player) return
        attachedPlayer?.removeListener(listener)
        attachedPlayer = player
        playerView.player = player
        player?.let {
            it.addListener(listener)
            it.setPlaybackSpeed(selectedSpeed)
            updatePlayPause(it.isPlaying)
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

    private fun handleTouch(view: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                animate().cancel()
                downX = event.x
                downY = event.y
                moved = false
                minimizing = false
                minimizeProgress = 0f
                holdSpeedActive = false
                holdRunnable?.let(handler::removeCallbacks)
                holdRunnable = Runnable {
                    if (moved || minimizing) return@Runnable
                    val exo = attachedPlayer ?: return@Runnable
                    holdSpeedActive = true
                    holdRestoreSpeed = exo.playbackParameters.speed
                    val fast = max(2f, holdRestoreSpeed).coerceAtMost(4f)
                    exo.setPlaybackSpeed(fast)
                    fastBadge.text = "${speedLabel(fast)}  Hold"
                    fastBadge.visibility = View.VISIBLE
                    handler.removeCallbacks(hideControls)
                }.also { handler.postDelayed(it, HOLD_MS) }
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = event.x - downX
                val dy = event.y - downY
                if (abs(dx) > dp(12) || abs(dy) > dp(12)) {
                    moved = true
                    holdRunnable?.let(handler::removeCallbacks)
                }
                if (dy > dp(8) && abs(dy) > abs(dx) * 1.12f) {
                    minimizing = true
                    minimizeProgress = (dy / (height.coerceAtLeast(dp(180)) * 0.72f)).coerceIn(0f, 1f)
                    applyMinimizeTransform(minimizeProgress)
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                holdRunnable?.let(handler::removeCallbacks)
                finishHoldSpeed()
                if (minimizing) animateResetMinimize()
                return true
            }

            MotionEvent.ACTION_UP -> {
                holdRunnable?.let(handler::removeCallbacks)
                if (holdSpeedActive) {
                    finishHoldSpeed()
                    return true
                }

                if (minimizing) {
                    val commit = minimizeProgress >= MINIMIZE_COMMIT_FRACTION
                    if (commit) animateCommitMinimize() else animateResetMinimize()
                    return true
                }
                if (moved) return true

                val now = SystemClock.uptimeMillis()
                val side = if (event.x < view.width / 2f) -1 else 1
                if (now - lastTapAt <= DOUBLE_TAP_MS && side == lastTapSide) {
                    singleTapRunnable?.let(handler::removeCallbacks)
                    rapidSeekSeconds += 10
                    seekBy(side * 10_000L)
                    showRapidSeek(side, rapidSeekSeconds)
                    lastTapAt = now
                    lastTapSide = side
                } else {
                    rapidSeekSeconds = 0
                    lastTapAt = now
                    lastTapSide = side
                    singleTapRunnable?.let(handler::removeCallbacks)
                    singleTapRunnable = Runnable {
                        if (SystemClock.uptimeMillis() - lastTapAt >= DOUBLE_TAP_MS) {
                            setControlsVisible(!controlsVisible)
                        }
                    }.also { handler.postDelayed(it, DOUBLE_TAP_MS) }
                }
                view.performClick()
                return true
            }
        }
        return true
    }

    private fun applyMinimizeTransform(progress: Float) {
        val scale = 1f - (0.30f * progress)
        scaleX = scale
        scaleY = scale
        translationY = height * 0.22f * progress
        translationX = width * 0.09f * progress
        controls.alpha = (1f - progress * 0.82f).coerceAtLeast(0.18f)
        setBackgroundColor(Color.argb((255 * (1f - progress * 0.5f)).toInt(), 0, 0, 0))
    }

    private fun animateCommitMinimize() {
        handler.removeCallbacks(hideControls)
        animate().cancel()
        animate()
            .scaleX(0.68f)
            .scaleY(0.68f)
            .translationX(width * 0.12f)
            .translationY(height * 0.25f)
            .alpha(0.9f)
            .setInterpolator(DecelerateInterpolator())
            .setDuration(115L)
            .withEndAction {
                onMinimize?.invoke()
                handler.postDelayed({ resetMinimizeImmediately() }, 180L)
            }
            .start()
    }

    private fun animateResetMinimize() {
        animate().cancel()
        controls.animate().alpha(1f).setDuration(150L).start()
        animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationX(0f)
            .translationY(0f)
            .alpha(1f)
            .setInterpolator(OvershootInterpolator(0.65f))
            .setDuration(220L)
            .withEndAction { resetMinimizeImmediately() }
            .start()
    }

    private fun resetMinimizeImmediately() {
        minimizing = false
        minimizeProgress = 0f
        scaleX = 1f
        scaleY = 1f
        translationX = 0f
        translationY = 0f
        alpha = 1f
        controls.alpha = 1f
        setBackgroundColor(Color.BLACK)
    }

    private fun seekBy(deltaMs: Long) {
        val exo = attachedPlayer ?: return
        val duration = exo.duration.takeIf { it > 0L } ?: Long.MAX_VALUE
        exo.seekTo((exo.currentPosition + deltaMs).coerceIn(0L, duration))
    }

    private fun finishHoldSpeed() {
        if (!holdSpeedActive) return
        holdSpeedActive = false
        attachedPlayer?.setPlaybackSpeed(holdRestoreSpeed)
        fastBadge.visibility = View.INVISIBLE
        showControlsTemporarily()
    }

    private fun showRapidSeek(side: Int, seconds: Int) {
        val hint = if (side < 0) leftHint else rightHint
        val other = if (side < 0) rightHint else leftHint
        other.visibility = View.INVISIBLE
        hint.text = if (side < 0) "↶  $seconds seconds" else "$seconds seconds  ↷"
        hint.alpha = 1f
        hint.visibility = View.VISIBLE
        rapidResetRunnable?.let(handler::removeCallbacks)
        rapidResetRunnable = Runnable {
            hint.animate().alpha(0f).setDuration(140L).withEndAction {
                hint.visibility = View.INVISIBLE
            }.start()
            rapidSeekSeconds = 0
        }.also { handler.postDelayed(it, 700L) }
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

    private fun showControlsTemporarily() {
        setControlsVisible(true)
        scheduleHide()
    }

    private fun scheduleHide() {
        handler.removeCallbacks(hideControls)
        if (attachedPlayer?.isPlaying == true) handler.postDelayed(hideControls, 3000L)
    }

    private fun setControlsVisible(visible: Boolean) {
        controlsVisible = visible
        controls.animate().cancel()
        controls.animate()
            .alpha(if (visible) 1f else 0f)
            .setDuration(150L)
            .withStartAction { if (visible) controls.visibility = View.VISIBLE }
            .withEndAction { if (!visible) controls.visibility = View.INVISIBLE }
            .start()
    }

    private fun updatePlayPause(isPlaying: Boolean) {
        playPause.setImageResource(if (isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        handler.removeCallbacks(progressUpdater)
        handler.post(progressUpdater)
    }

    override fun onDetachedFromWindow() {
        handler.removeCallbacks(progressUpdater)
        handler.removeCallbacks(hideControls)
        holdRunnable?.let(handler::removeCallbacks)
        singleTapRunnable?.let(handler::removeCallbacks)
        rapidResetRunnable?.let(handler::removeCallbacks)
        super.onDetachedFromWindow()
    }

    private fun iconButton(resource: Int, description: String, circle: Boolean = false) =
        AppCompatImageButton(context).apply {
            setImageResource(resource)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            contentDescription = description
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = if (circle) roundedBackground(Color.argb(150, 15, 15, 15), 100f) else null
            isClickable = true
            isFocusable = true
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

    private fun verticalShade(topColor: Int, bottomColor: Int) = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(topColor, bottomColor),
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

    private fun speedLabel(speed: Float): String =
        if (speed % 1f == 0f) "${speed.toInt()}×" else "${speed}×"

    companion object {
        private const val PLAYER_PREFS = "native_player_positions_v2"
        private const val SPEED_KEY = "youtube_style_speed"
        private const val DOUBLE_TAP_MS = 280L
        private const val HOLD_MS = 450L
        private const val MINIMIZE_COMMIT_FRACTION = 0.34f
    }
}
