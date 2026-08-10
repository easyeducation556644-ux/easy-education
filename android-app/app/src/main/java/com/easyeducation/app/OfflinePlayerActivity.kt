package com.easyeducation.app

import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
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
import kotlin.math.max
import kotlin.math.min

@UnstableApi
class OfflinePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var controls: View? = null
    private var playPauseButton: Button? = null
    private var speedButton: Button? = null
    private var timeText: TextView? = null
    private var seekBar: SeekBar? = null
    private var isSeeking = false
    private var controlsVisible = true
    private var currentId = ""
    private val handler = Handler(Looper.getMainLooper())
    private val hideControls = Runnable { setControlsVisible(false) }
    private val updateProgress = object : Runnable {
        override fun run() {
            val exo = player
            if (exo != null && !isSeeking) {
                val duration = max(0L, exo.duration.takeIf { it > 0 } ?: 0L)
                val position = max(0L, exo.currentPosition)
                seekBar?.progress = if (duration > 0) ((position * 1000L) / duration).toInt().coerceIn(0, 1000) else 0
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

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

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

        setContentView(root)
        enterImmersiveMode()

        val gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                setControlsVisible(!controlsVisible)
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                val exo = player ?: return true
                val delta = if (e.x < root.width / 2f) -10_000L else 10_000L
                val duration = exo.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
                exo.seekTo((exo.currentPosition + delta).coerceIn(0L, duration))
                showControlsTemporarily()
                return true
            }
        })
        playerView?.setOnTouchListener { _, event -> gestureDetector.onTouchEvent(event) }

        player = ExoPlayer.Builder(this).build().also { exo ->
            playerView?.player = exo
            exo.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    updatePlayButton(isPlaying)
                    if (isPlaying) scheduleHide() else handler.removeCallbacks(hideControls)
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        setControlsVisible(true)
                        updatePlayButton(false)
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    setControlsVisible(true)
                    Toast.makeText(
                        this@OfflinePlayerActivity,
                        "Offline video play failed: ${error.errorCodeName}",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            })
            exo.setMediaItem(MediaItem.fromUri(Uri.fromFile(video)))
            exo.prepare()
            val savedPosition = getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
                .getLong(positionKey(currentId), 0L)
            if (savedPosition > 0L) exo.seekTo(savedPosition)
            exo.playWhenReady = true
        }

        handler.post(updateProgress)
        showControlsTemporarily()
    }

    private fun buildControls(title: String, quality: String): View {
        val overlay = FrameLayout(this)

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.argb(145, 0, 0, 0))
        }
        val back = Button(this).apply {
            text = "‹"
            textSize = 28f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            minWidth = dp(52)
            minHeight = dp(46)
            setOnClickListener { finish() }
        }
        top.addView(back, LinearLayout.LayoutParams(dp(58), dp(48)))
        top.addView(TextView(this).apply {
            text = title
            textSize = 16f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (quality.isNotBlank()) {
            top.addView(TextView(this).apply {
                text = quality
                textSize = 13f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setPadding(dp(10), dp(5), dp(10), dp(5))
                setBackgroundColor(Color.argb(155, 40, 40, 40))
            })
        }
        overlay.addView(top, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(64),
            Gravity.TOP,
        ))

        val center = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val rewind = controlButton("↶ 10") {
            seekBy(-10_000L)
        }
        playPauseButton = controlButton("❚❚") {
            val exo = player ?: return@controlButton
            if (exo.isPlaying) exo.pause() else exo.play()
            showControlsTemporarily()
        }.apply { textSize = 24f }
        val forward = controlButton("10 ↷") {
            seekBy(10_000L)
        }
        center.addView(rewind, LinearLayout.LayoutParams(dp(92), dp(60)).apply { marginEnd = dp(24) })
        center.addView(playPauseButton, LinearLayout.LayoutParams(dp(76), dp(68)))
        center.addView(forward, LinearLayout.LayoutParams(dp(92), dp(60)).apply { marginStart = dp(24) })
        overlay.addView(center, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER,
        ))

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(5), dp(16), dp(8))
            setBackgroundColor(Color.argb(155, 0, 0, 0))
        }
        seekBar = SeekBar(this).apply {
            max = 1000
            progress = 0
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
            dp(34),
        ))

        val bottomRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        timeText = TextView(this).apply {
            text = "0:00 / 0:00"
            textSize = 13f
            setTextColor(Color.WHITE)
        }
        bottomRow.addView(timeText, LinearLayout.LayoutParams(0, dp(42), 1f))

        val mute = Button(this).apply {
            text = "🔊"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                val exo = player ?: return@setOnClickListener
                exo.volume = if (exo.volume > 0f) 0f else 1f
                text = if (exo.volume > 0f) "🔊" else "🔇"
                showControlsTemporarily()
            }
        }
        bottomRow.addView(mute, LinearLayout.LayoutParams(dp(60), dp(42)))

        speedButton = Button(this).apply {
            text = "1×"
            textSize = 14f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { showSpeedMenu(this) }
        }
        bottomRow.addView(speedButton, LinearLayout.LayoutParams(dp(70), dp(42)))
        bottom.addView(bottomRow)

        overlay.addView(bottom, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(92),
            Gravity.BOTTOM,
        ))
        return overlay
    }

    private fun controlButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 16f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        setBackgroundColor(Color.argb(130, 20, 20, 20))
        setOnClickListener { action() }
    }

    private fun showSpeedMenu(anchor: View) {
        handler.removeCallbacks(hideControls)
        val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f, 3.5f, 4f)
        PopupMenu(this, anchor).apply {
            speeds.forEachIndexed { index, speed ->
                menu.add(0, index, index, speedLabel(speed))
            }
            setOnMenuItemClickListener { item ->
                val speed = speeds.getOrNull(item.itemId) ?: return@setOnMenuItemClickListener false
                player?.setPlaybackSpeed(speed)
                speedButton?.text = speedLabel(speed)
                showControlsTemporarily()
                true
            }
            setOnDismissListener { showControlsTemporarily() }
            show()
        }
    }

    private fun speedLabel(speed: Float): String {
        val raw = if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().trimEnd('0')
        return "${raw}×"
    }

    private fun seekBy(deltaMs: Long) {
        val exo = player ?: return
        val duration = exo.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        exo.seekTo((exo.currentPosition + deltaMs).coerceIn(0L, duration))
        showControlsTemporarily()
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
        if (player?.isPlaying == true) handler.postDelayed(hideControls, 3000)
    }

    private fun setControlsVisible(visible: Boolean) {
        controlsVisible = visible
        controls?.animate()?.cancel()
        controls?.animate()
            ?.alpha(if (visible) 1f else 0f)
            ?.setDuration(150)
            ?.withEndAction {
                controls?.visibility = if (visible) View.VISIBLE else View.INVISIBLE
            }
            ?.start()
        if (visible) controls?.visibility = View.VISIBLE
        if (visible) scheduleHide() else handler.removeCallbacks(hideControls)
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
        private fun positionKey(id: String) = "position:$id"
    }
}
