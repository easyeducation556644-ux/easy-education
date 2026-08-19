package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
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
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.firebase.auth.FirebaseAuth
import kotlin.math.abs

/**
 * Persistent draggable in-app miniplayer. The full video surface is the drag handle (except the
 * actual control buttons), so users do not need to discover a tiny title bar before drag/drop works.
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
    private var playerListener: Player.Listener? = null
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
        detachPlayerListener()
        host = activity
        player = exoPlayer
        suppressNextPause = false

        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        val width = dp(activity, if (activity.resources.configuration.smallestScreenWidthDp >= 600) 330 else 252)
        val height = (width * 9f / 16f).toInt()
        val shell = FrameLayout(activity).apply {
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
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
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

        val dragLayer = View(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
        }
        shell.addView(
            dragLayer,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        val play = miniButton(activity, if (exoPlayer.isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play, "Play or pause")
        shell.addView(
            play,
            FrameLayout.LayoutParams(dp(activity, 50), dp(activity, 50), Gravity.CENTER),
        )

        val close = miniButton(activity, R.drawable.ic_player_close, "Close mini player")
        shell.addView(
            close,
            FrameLayout.LayoutParams(dp(activity, 42), dp(activity, 42), Gravity.TOP or Gravity.END).apply {
                topMargin = dp(activity, 4)
                marginEnd = dp(activity, 4)
            },
        )

        play.setOnClickListener {
            if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
        }
        close.setOnClickListener { dismiss(releasePlayer = true) }

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                play.setImageResource(if (isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play)
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

        dragLayer.setOnTouchListener { view, event ->
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
                        val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
                        val maxY = (root.height - shell.height).coerceAtLeast(0).toFloat()
                        shell.x = (startX + dx).coerceIn(0f, maxX)
                        shell.y = (startY + dy).coerceIn(0f, maxY)
                        val verticalTravel = if (root.height > 0) dy / root.height else 0f
                        shell.alpha = (1f - verticalTravel.coerceAtLeast(0f) * 0.65f).coerceIn(0.55f, 1f)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    when {
                        !dragging -> {
                            view.performClick()
                            expandSharedPlayer()
                        }
                        dy < -dp(activity, 86) && abs(dy) > abs(dx) -> expandSharedPlayer()
                        dy > dp(activity, 135) && abs(dy) > abs(dx) -> {
                            shell.animate().alpha(0f).translationY(dp(activity, 100).toFloat()).setDuration(140L)
                                .withEndAction { dismiss(releasePlayer = true) }.start()
                        }
                        else -> {
                            val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
                            val maxY = (root.height - shell.height).coerceAtLeast(0).toFloat()
                            val targetX = if (shell.x + shell.width / 2f < root.width / 2f) 0f else maxX
                            val targetY = shell.y.coerceIn(0f, maxY)
                            shell.animate()
                                .x(targetX)
                                .y(targetY)
                                .alpha(1f)
                                .setDuration(180L)
                                .start()
                        }
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    shell.animate().alpha(1f).setDuration(120L).start()
                    true
                }

                else -> true
            }
        }

        root.addView(
            shell,
            FrameLayout.LayoutParams(width, height, Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = dp(activity, 10)
                bottomMargin = dp(activity, 82)
            },
        )
        shell.alpha = 0f
        shell.scaleX = 0.82f
        shell.scaleY = 0.82f
        shell.translationY = dp(activity, 44).toFloat()
        shell.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setDuration(180L)
            .start()

        play.bringToFront()
        close.bringToFront()
        attachLifecycle(activity, exoPlayer, play)
        attachAuthListener(exoPlayer)
    }

    fun dismiss(releasePlayer: Boolean = true) {
        val currentHost = host
        val currentPlayer = player
        detachPlayerListener()
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

    private fun attachLifecycle(activity: Activity, exoPlayer: ExoPlayer, playButton: AppCompatImageButton) {
        detachLifecycle()
        val owner = activity as? LifecycleOwner ?: return
        val observer = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                if (player === exoPlayer && !suppressNextPause) {
                    PersistentNativePlayer.savePosition(activity)
                    exoPlayer.pause()
                    playButton.setImageResource(R.drawable.ic_player_play)
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

    private fun miniButton(context: Context, drawable: Int, description: String) = AppCompatImageButton(context).apply {
        setImageResource(drawable)
        contentDescription = description
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        setPadding(dp(context, 11), dp(context, 11), dp(context, 11), dp(context, 11))
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.argb(155, 10, 10, 10))
        }
    }

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    private const val PLAYER_PREFS = "native_player_positions_v2"
}
