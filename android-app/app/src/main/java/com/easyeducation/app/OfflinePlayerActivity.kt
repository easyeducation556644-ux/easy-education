package com.easyeducation.app

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.io.File
import kotlin.math.abs
import kotlin.math.max

@UnstableApi
class OfflinePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var controls: FrameLayout? = null
    private var playPauseButton: TextView? = null
    private var speedButton: TextView? = null
    private var muteButton: TextView? = null
    private var timeText: TextView? = null
    private var seekBar: SeekBar? = null
    private var bufferingText: TextView? = null
    private var quickSeekFeedback: YoutubeQuickSeekFeedbackView? = null
    private var fastBadge: TextView? = null

    private var isSeeking = false
    private var controlsVisible = true
    private var currentId = ""
    private var selectedSpeed = 1f

    private var lastTapAt = 0L
    private var lastTapSide = 0
    private var rapidSeekSeconds = 0
    private var rapidSeekSide = 0
    private var lastRapidSeekAt = 0L
    private var downX = 0f
    private var downY = 0f
    private var moved = false
    private var longPressActive = false
    private var temporarySpeedRestore = 1f
    private var singleTapRunnable: Runnable? = null
    private var longPressRunnable: Runnable? = null
    private var rapidResetRunnable: Runnable? = null

    private val handler = Handler(Looper.getMainLooper())
    private val hideControls = Runnable { setControlsVisible(false) }
    private val updateProgress = object : Runnable {
        override fun run() {
            val exo = player
            if (exo != null && !isSeeking) {
                val duration = max(0L, exo.duration.takeIf { it > 0 } ?: 0L)
                val position = max(0L, exo.currentPosition)
                val buffered = max(position, exo.bufferedPosition)
                seekBar?.progress = if (duration > 0) {
                    ((position * 1000L) / duration).toInt().coerceIn(0, 1000)
                } else 0
                seekBar?.secondaryProgress = if (duration > 0) {
                    ((buffered * 1000L) / duration).toInt().coerceIn(0, 1000)
                } else 0
                timeText?.text = "${formatTime(position)} / ${formatTime(duration)}"
            }
            handler.postDelayed(this, 250)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        currentId = intent.getStringExtra(EXTRA_ID).orEmpty()
        val video = if (currentId.isNotBlank()) {
            File(HlsDownloadService.offlineDir(this, currentId), "video.mp4")
        } else null
        val task = DownloadStore(this).get(currentId)

        if (video == null || !video.exists() || video.length() <= 0L) {
            Toast.makeText(this, "Downloaded video file পাওয়া যায়নি", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val prefs = getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
        selectedSpeed = prefs.getFloat(SPEED_KEY, 1f).coerceIn(0.25f, 4f)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            setBackgroundColor(Color.BLACK)
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            keepScreenOn = true
        }.also { view ->
            root.addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }

        val gestureLayer = View(this).apply {
            isClickable = true
            isFocusable = true
            setBackgroundColor(Color.TRANSPARENT)
            setOnTouchListener { view, event -> handlePlayerTouch(view, event) }
        }
        root.addView(
            gestureLayer,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        controls = buildControls(
            title = task?.title.orEmpty().ifBlank { "Downloaded video" },
            quality = task?.height?.takeIf { it > 0 }?.let { "${it}p" }.orEmpty(),
        ).also { overlay ->
            root.addView(
                overlay,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }

        quickSeekFeedback = YoutubeQuickSeekFeedbackView(this).also {
            root.addView(
                it,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
            )
        }
        fastBadge = pillText("2×").apply {
            visibility = View.INVISIBLE
        }.also {
            root.addView(it, FrameLayout.LayoutParams(dp(92), dp(46), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
                topMargin = dp(28)
            })
        }

        setContentView(root)
        enterImmersiveMode()

        player = ExoPlayer.Builder(this).build().also { exo ->
            playerView?.player = exo
            exo.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    updatePlayButton(isPlaying)
                    if (isPlaying) scheduleHide() else handler.removeCallbacks(hideControls)
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    bufferingText?.visibility = if (playbackState == Player.STATE_BUFFERING) View.VISIBLE else View.INVISIBLE
                    if (playbackState == Player.STATE_ENDED) {
                        setControlsVisible(true)
                        updatePlayButton(false)
                        prefs.edit().remove(positionKey(currentId)).apply()
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    setControlsVisible(true)
                    bufferingText?.visibility = View.INVISIBLE
                    Toast.makeText(
                        this@OfflinePlayerActivity,
                        "Offline video play failed: ${error.errorCodeName}",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            })
            exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(video)))
            exo.prepare()
            exo.setPlaybackSpeed(selectedSpeed)
            val savedPosition = prefs.getLong(positionKey(currentId), 0L)
            if (savedPosition > 0L) exo.seekTo(savedPosition)
            exo.playWhenReady = true
        }

        handler.post(updateProgress)
        showControlsTemporarily()
    }

    private fun buildControls(title: String, quality: String): FrameLayout {
        val overlay = FrameLayout(this)

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(10), dp(7))
            setBackgroundColor(Color.argb(120, 0, 0, 0))
        }
        val back = iconText("‹", 32f).apply {
            contentDescription = "Back"
            setOnClickListener { finish() }
        }
        top.addView(back, LinearLayout.LayoutParams(dp(54), dp(50)))
        top.addView(TextView(this).apply {
            text = title
            textSize = 15f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(50), 1f))
        if (quality.isNotBlank()) {
            top.addView(pillText(quality), LinearLayout.LayoutParams(dp(68), dp(36)).apply {
                marginEnd = dp(6)
            })
        }
        val settings = iconText("⚙", 21f).apply {
            contentDescription = "Playback settings"
            setOnClickListener { showSpeedMenu(this) }
        }
        top.addView(settings, LinearLayout.LayoutParams(dp(52), dp(50)))
        overlay.addView(top, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(64),
            Gravity.TOP,
        ))

        playPauseButton = iconText("▶", 31f, circle = true).apply {
            contentDescription = "Play or pause"
            setOnClickListener {
                val exo = player ?: return@setOnClickListener
                if (exo.isPlaying) exo.pause() else exo.play()
                showControlsTemporarily()
            }
        }
        overlay.addView(playPauseButton, FrameLayout.LayoutParams(dp(72), dp(72), Gravity.CENTER))

        bufferingText = pillText("Loading…").apply {
            visibility = View.INVISIBLE
        }
        overlay.addView(bufferingText, FrameLayout.LayoutParams(dp(110), dp(40), Gravity.CENTER).apply {
            topMargin = dp(96)
        })

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(2), dp(14), dp(7))
            setBackgroundColor(Color.argb(135, 0, 0, 0))
        }
        seekBar = SeekBar(this).apply {
            max = 1000
            progress = 0
            secondaryProgress = 0
            progressTintList = ColorStateList.valueOf(Color.rgb(255, 25, 25))
            secondaryProgressTintList = ColorStateList.valueOf(Color.argb(210, 220, 220, 220))
            progressBackgroundTintList = ColorStateList.valueOf(Color.argb(130, 130, 130, 130))
            thumbTintList = ColorStateList.valueOf(Color.rgb(255, 25, 25))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(seekBar: SeekBar?) {
                    isSeeking = true
                    handler.removeCallbacks(hideControls)
                }

                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val duration = player?.duration?.takeIf { it > 0 } ?: return
                    val target = duration * progress / 1000L
                    timeText?.text = "${formatTime(target)} / ${formatTime(duration)}"
                }

                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    val exo = player
                    val duration = exo?.duration?.takeIf { it > 0 } ?: 0L
                    if (exo != null && duration > 0) {
                        exo.seekTo(duration * (seekBar?.progress ?: 0) / 1000L)
                    }
                    isSeeking = false
                    showControlsTemporarily()
                }
            })
        }
        bottom.addView(seekBar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(32),
        ))

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        timeText = TextView(this).apply {
            text = "0:00 / 0:00"
            textSize = 12.5f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(timeText, LinearLayout.LayoutParams(0, dp(40), 1f))

        muteButton = iconText("🔊", 17f).apply {
            contentDescription = "Mute"
            setOnClickListener {
                val exo = player ?: return@setOnClickListener
                exo.volume = if (exo.volume > 0f) 0f else 1f
                text = if (exo.volume > 0f) "🔊" else "🔇"
                showControlsTemporarily()
            }
        }
        row.addView(muteButton, LinearLayout.LayoutParams(dp(54), dp(40)))

        speedButton = TextView(this).apply {
            text = speedLabel(selectedSpeed)
            textSize = 13f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setOnClickListener { showSpeedMenu(this) }
        }
        row.addView(speedButton, LinearLayout.LayoutParams(dp(62), dp(40)))
        bottom.addView(row)

        overlay.addView(bottom, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(82),
            Gravity.BOTTOM,
        ))
        return overlay
    }

    private fun handlePlayerTouch(view: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                moved = false
                longPressActive = false
                longPressRunnable?.let(handler::removeCallbacks)
                longPressRunnable = Runnable {
                    if (moved) return@Runnable
                    val exo = player ?: return@Runnable
                    longPressActive = true
                    temporarySpeedRestore = exo.playbackParameters.speed
                    val fastSpeed = max(2f, temporarySpeedRestore)
                    exo.setPlaybackSpeed(fastSpeed)
                    fastBadge?.text = "${speedLabel(fastSpeed)}  Hold"
                    fastBadge?.visibility = View.VISIBLE
                    handler.removeCallbacks(hideControls)
                }.also { handler.postDelayed(it, LONG_PRESS_MS) }
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (abs(event.x - downX) > dp(18) || abs(event.y - downY) > dp(18)) {
                    moved = true
                    longPressRunnable?.let(handler::removeCallbacks)
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                longPressRunnable?.let(handler::removeCallbacks)
                finishTemporarySpeed()
                return true
            }

            MotionEvent.ACTION_UP -> {
                longPressRunnable?.let(handler::removeCallbacks)
                if (longPressActive) {
                    finishTemporarySpeed()
                    return true
                }
                if (moved) return true

                val now = SystemClock.uptimeMillis()
                val side = if (event.x < view.width / 2f) -1 else 1
                if (now - lastTapAt <= RAPID_TAP_WINDOW_MS && side == lastTapSide) {
                    singleTapRunnable?.let(handler::removeCallbacks)
                    rapidSeekSeconds = if (side == rapidSeekSide && now - lastRapidSeekAt <= RAPID_RESET_MS) {
                        (rapidSeekSeconds + 10).coerceAtMost(60)
                    } else {
                        10
                    }
                    rapidSeekSide = side
                    lastRapidSeekAt = now
                    seekBy(side * 10_000L, showControls = false)
                    showRapidSeek(side, rapidSeekSeconds)
                    lastTapAt = now
                    lastTapSide = side
                } else {
                    rapidSeekSeconds = 0
                    lastTapAt = now
                    lastTapSide = side
                    singleTapRunnable?.let(handler::removeCallbacks)
                    singleTapRunnable = Runnable {
                        if (SystemClock.uptimeMillis() - lastTapAt >= RAPID_TAP_WINDOW_MS) {
                            setControlsVisible(!controlsVisible)
                        }
                    }.also { handler.postDelayed(it, RAPID_TAP_WINDOW_MS) }
                }
                view.performClick()
                return true
            }
        }
        return true
    }

    private fun showRapidSeek(side: Int, seconds: Int) {
        quickSeekFeedback?.show(side, seconds)
        rapidResetRunnable?.let(handler::removeCallbacks)
        rapidResetRunnable = Runnable {
            rapidSeekSeconds = 0
            rapidSeekSide = 0
            lastRapidSeekAt = 0L
        }.also { handler.postDelayed(it, RAPID_RESET_MS) }
    }

    private fun finishTemporarySpeed() {
        if (!longPressActive) return
        longPressActive = false
        player?.setPlaybackSpeed(temporarySpeedRestore)
        fastBadge?.visibility = View.INVISIBLE
        scheduleHide()
    }

    private fun showSpeedMenu(anchor: View) {
        handler.removeCallbacks(hideControls)
        val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f, 3.5f, 4f)
        PopupMenu(this, anchor).apply {
            speeds.forEachIndexed { index, speed ->
                val marker = if (speed == selectedSpeed) "✓ " else ""
                menu.add(0, index, index, "$marker${speedLabel(speed)}")
            }
            setOnMenuItemClickListener { item ->
                val speed = speeds.getOrNull(item.itemId) ?: return@setOnMenuItemClickListener false
                selectedSpeed = speed
                player?.setPlaybackSpeed(speed)
                speedButton?.text = speedLabel(speed)
                getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
                    .edit()
                    .putFloat(SPEED_KEY, speed)
                    .apply()
                showControlsTemporarily()
                true
            }
            setOnDismissListener { showControlsTemporarily() }
            show()
        }
    }

    private fun seekBy(deltaMs: Long, showControls: Boolean = true) {
        val exo = player ?: return
        val duration = exo.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        exo.seekTo((exo.currentPosition + deltaMs).coerceIn(0L, duration))
        if (showControls) showControlsTemporarily()
    }

    private fun updatePlayButton(isPlaying: Boolean) {
        playPauseButton?.text = if (isPlaying) "❚❚" else "▶"
    }

    private fun showControlsTemporarily() {
        setControlsVisible(true)
        scheduleHide()
    }

    private fun scheduleHide() {
        handler.removeCallbacks(hideControls)
        if (player?.isPlaying == true && !isSeeking && !longPressActive) {
            handler.postDelayed(hideControls, 2600)
        }
    }

    private fun setControlsVisible(visible: Boolean) {
        controlsVisible = visible
        controls?.animate()?.cancel()
        if (visible) {
            controls?.visibility = View.VISIBLE
            controls?.animate()?.alpha(1f)?.setDuration(120)?.start()
            scheduleHide()
        } else {
            controls?.animate()?.alpha(0f)?.setDuration(140)?.withEndAction {
                controls?.visibility = View.INVISIBLE
            }?.start()
            handler.removeCallbacks(hideControls)
        }
    }

    private fun iconText(label: String, size: Float, circle: Boolean = false) = TextView(this).apply {
        text = label
        textSize = size
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        isClickable = true
        isFocusable = true
        if (circle) background = roundedBackground(Color.argb(145, 20, 20, 20), 999f)
        else setBackgroundColor(Color.TRANSPARENT)
    }

    private fun pillText(label: String) = TextView(this).apply {
        text = label
        textSize = 12.5f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(9), dp(4), dp(9), dp(4))
        background = roundedBackground(Color.argb(155, 35, 35, 35), 12f)
    }

    private fun seekHint(gravityValue: Int) = TextView(this).apply {
        gravity = Gravity.CENTER
        textSize = 14f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        background = roundedBackground(Color.argb(175, 20, 20, 20), 40f)
        visibility = View.INVISIBLE
        contentDescription = if (gravityValue and Gravity.START == Gravity.START) "Rewind" else "Forward"
    }

    private fun roundedBackground(color: Int, radiusDp: Float) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(color)
        cornerRadius = dp(radiusDp.toInt()).toFloat()
    }

    private fun speedLabel(speed: Float): String {
        val raw = if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().trimEnd('0')
        return "${raw}×"
    }

    private fun formatTime(valueMs: Long): String {
        val totalSeconds = max(0L, valueMs) / 1000L
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds)
        else "%d:%02d".format(minutes, seconds)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onPause() {
        super.onPause()
        val position = player?.currentPosition ?: 0L
        if (currentId.isNotBlank() && position > 0L) {
            getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
                .edit()
                .putLong(positionKey(currentId), position)
                .apply()
        }
    }

    override fun onDestroy() {
        singleTapRunnable?.let(handler::removeCallbacks)
        longPressRunnable?.let(handler::removeCallbacks)
        rapidResetRunnable?.let(handler::removeCallbacks)
        quickSeekFeedback?.hideImmediately()
        handler.removeCallbacksAndMessages(null)
        playerView?.player = null
        player?.release()
        player = null
        playerView = null
        controls = null
        super.onDestroy()
    }

    private fun enterImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    companion object {
        const val EXTRA_ID = "offline_download_id"
        private const val PLAYER_PREFS = "offline_player_state"
        private const val SPEED_KEY = "playback_speed"
        private const val RAPID_TAP_WINDOW_MS = 330L
        private const val RAPID_RESET_MS = 720L
        private const val LONG_PRESS_MS = 460L
        private fun positionKey(id: String) = "position:$id"
    }
}
