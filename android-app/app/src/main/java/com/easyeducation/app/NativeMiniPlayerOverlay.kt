package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.firebase.auth.FirebaseAuth
import kotlin.math.abs

/**
 * Persistent in-app miniplayer. The watch page hands the same ExoPlayer instance here so buffer,
 * decoder state, position and speed survive the transition. Expand hands that same session to the
 * fullscreen activity instead of releasing and resolving again.
 */
@UnstableApi
object NativeMiniPlayerOverlay {
    private var host: Activity? = null
    private var container: FrameLayout? = null
    private var videoView: PlayerView? = null
    private var player: ExoPlayer? = null
    private var lifecycleOwner: LifecycleOwner? = null
    private var lifecycleObserver: DefaultLifecycleObserver? = null
    private var authListener: FirebaseAuth.AuthStateListener? = null
    private var suppressNextPause = false

    fun show(
        activity: Activity,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
    ) {
        if (host !== activity) dismiss(releasePlayer = true)
        removeContainerOnly()
        host = activity
        player = exoPlayer
        suppressNextPause = false

        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        val width = dp(activity, if (activity.resources.configuration.smallestScreenWidthDp >= 600) 320 else 244)
        val height = (width * 9f / 16f).toInt()
        val shell = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            elevation = dp(activity, 18).toFloat()
            clipToOutline = true
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            background = GradientDrawable().apply {
                setColor(Color.BLACK)
                cornerRadius = dp(activity, 12).toFloat()
            }
        }
        container = shell

        val pv = PlayerView(activity).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            keepScreenOn = true
            player = exoPlayer
            setBackgroundColor(Color.BLACK)
        }
        videoView = pv
        shell.addView(
            pv,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        val shade = View(activity).apply { setBackgroundColor(Color.argb(28, 0, 0, 0)) }
        shell.addView(
            shade,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        fun expandSharedPlayer() {
            savePosition(activity, classId, exoPlayer.currentPosition)
            suppressNextPause = true
            dismiss(releasePlayer = false)
            activity.startActivity(
                Intent(activity, NativePlayerActivity::class.java)
                    .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, sourceUrl)
                    .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, classId)
                    .putExtra(NativePlayerActivity.EXTRA_HEIGHT, requestedHeight)
                    .putExtra(NativePlayerActivity.EXTRA_TITLE, title)
                    .putExtra(NativePlayerActivity.EXTRA_SHARED_SESSION, true),
            )
            @Suppress("DEPRECATION")
            activity.overridePendingTransition(0, 0)
        }

        val play = TextView(activity).apply {
            text = if (exoPlayer.isPlaying) "❚❚" else "▶"
            textSize = 22f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            background = circle(Color.argb(150, 10, 10, 10))
            setOnClickListener {
                if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
                text = if (exoPlayer.isPlaying) "❚❚" else "▶"
            }
        }
        shell.addView(play, FrameLayout.LayoutParams(dp(activity, 48), dp(activity, 48), Gravity.CENTER))

        val close = TextView(activity).apply {
            text = "×"
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = circle(Color.argb(145, 15, 15, 15))
            contentDescription = "Close mini player"
            setOnClickListener { dismiss(releasePlayer = true) }
        }
        shell.addView(
            close,
            FrameLayout.LayoutParams(dp(activity, 38), dp(activity, 38), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(activity, 5)
                marginEnd = dp(activity, 5)
            },
        )

        val titleBar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(activity, 9), 0, dp(activity, 48), 0)
            setBackgroundColor(Color.argb(86, 0, 0, 0))
        }
        val label = TextView(activity).apply {
            text = title.ifBlank { "Class" }
            textSize = 11.5f
            maxLines = 1
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
        }
        titleBar.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        shell.addView(
            titleBar,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(activity, 42),
                Gravity.TOP,
            ),
        )

        val expandTap = View(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { expandSharedPlayer() }
        }
        shell.addView(
            expandTap,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ).apply {
                topMargin = dp(activity, 42)
                bottomMargin = dp(activity, 48)
            },
        )

        play.bringToFront()
        titleBar.bringToFront()
        close.bringToFront()

        var downRawX = 0f
        var downRawY = 0f
        var startX = 0f
        var startY = 0f
        var downAt = 0L
        titleBar.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = shell.x
                    startY = shell.y
                    downAt = SystemClock.uptimeMillis()
                    shell.animate().cancel()
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
                    val maxY = (root.height - shell.height).coerceAtLeast(0).toFloat()
                    shell.x = (startX + dx).coerceIn(0f, maxX)
                    shell.y = (startY + dy).coerceIn(0f, maxY)
                    true
                }

                MotionEvent.ACTION_UP -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    val moved = abs(dx) > dp(activity, 8) || abs(dy) > dp(activity, 8)
                    when {
                        dy < -dp(activity, 86) && abs(dy) > abs(dx) -> expandSharedPlayer()
                        dy > dp(activity, 118) && abs(dy) > abs(dx) -> dismiss(releasePlayer = true)
                        moved -> {
                            val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
                            val targetX = if (shell.x + shell.width / 2f < root.width / 2f) 0f else maxX
                            shell.animate().x(targetX).setDuration(170L).start()
                        }
                        SystemClock.uptimeMillis() - downAt < 250L -> view.performClick()
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> true
                else -> true
            }
        }

        root.addView(
            shell,
            FrameLayout.LayoutParams(width, height, Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = dp(activity, 12)
                bottomMargin = dp(activity, 86)
            },
        )
        shell.alpha = 0f
        shell.scaleX = 0.86f
        shell.scaleY = 0.86f
        shell.translationY = dp(activity, 36).toFloat()
        shell.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setDuration(190L)
            .start()

        attachLifecycle(activity, exoPlayer, play)
        attachAuthListener(exoPlayer)
    }

    /**
     * releasePlayer=true means the user explicitly closed playback. PersistentNativePlayer is not
     * released as an object; its media session is stopped/cleared so the singleton remains reusable.
     */
    fun dismiss(releasePlayer: Boolean = true) {
        val currentHost = host
        val currentPlayer = player
        removeContainerOnly()
        player = null
        detachLifecycle()
        detachAuthListener()
        host = null
        if (releasePlayer && currentHost != null && currentPlayer != null) {
            PersistentNativePlayer.stopIfOwned(currentHost, currentPlayer)
        }
    }

    fun owns(exoPlayer: ExoPlayer): Boolean = player === exoPlayer && container != null

    private fun attachLifecycle(activity: Activity, exoPlayer: ExoPlayer, playButton: TextView) {
        detachLifecycle()
        val owner = activity as? LifecycleOwner ?: return
        val observer = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                if (player === exoPlayer && !suppressNextPause) {
                    PersistentNativePlayer.savePosition(activity)
                    exoPlayer.pause()
                    playButton.text = "▶"
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
        videoView?.player = null
        videoView = null
        container?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        container = null
    }

    private fun savePosition(context: Context, classId: String, position: Long) {
        if (classId.isBlank() || position <= 0L) return
        context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit().putLong("class:$classId", position).apply()
    }

    private fun circle(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    private const val PLAYER_PREFS = "native_player_positions_v2"
}
