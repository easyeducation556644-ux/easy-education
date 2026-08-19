package com.easyeducation.app

import android.app.Activity
import android.content.Context
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
 * In-app miniplayer backed by the same ExoPlayer session. Tapping/dragging upward expands the mini
 * surface first, then restores the class route; it never launches a second fullscreen Activity and
 * never calls the resolver/prepare path for the current media item.
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
    private var expandCallback: (() -> Unit)? = null
    private var expanding = false

    fun show(
        activity: Activity,
        exoPlayer: ExoPlayer,
        classId: String,
        sourceUrl: String,
        title: String,
        requestedHeight: Int,
        onExpandToWatchPage: (() -> Unit)? = null,
    ) {
        if (host !== activity) dismiss(releasePlayer = true)
        removeContainerOnly()
        detachPlayerListener()
        host = activity
        player = exoPlayer
        expandCallback = onExpandToWatchPage
        suppressNextPause = false
        expanding = false

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

        fun expandToWatchPage() {
            if (expanding) return
            expanding = true
            PersistentNativePlayer.savePosition(activity)
            suppressNextPause = true
            shell.animate().cancel()

            val composePage = root.getChildAt(0)?.takeIf { it !== shell }
            composePage?.animate()?.cancel()
            composePage?.animate()?.alpha(0.62f)?.setDuration(170L)?.start()

            // Same 16:9 surface grows toward the watch-page player position before navigation.
            val targetScale = (root.width.toFloat() / shell.width.coerceAtLeast(1)).coerceAtLeast(1f)
            shell.pivotX = 0f
            shell.pivotY = 0f
            shell.animate()
                .x(0f)
                .y(0f)
                .scaleX(targetScale)
                .scaleY(targetScale)
                .alpha(1f)
                .setDuration(235L)
                .withEndAction {
                    composePage?.alpha = 1f
                    val callback = expandCallback
                    dismiss(releasePlayer = false)
                    callback?.invoke()
                }
                .start()
        }

        val dragLayer = View(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
        }
        shell.addView(
            dragLayer,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        val play = miniButton(
            activity,
            if (exoPlayer.isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play,
            "Play or pause",
        )
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
        close.setOnClickListener {
            shell.animate().cancel()
            shell.animate()
                .alpha(0f)
                .scaleX(0.82f)
                .scaleY(0.82f)
                .translationY(dp(activity, 70).toFloat())
                .setDuration(150L)
                .withEndAction { dismiss(releasePlayer = true) }
                .start()
        }

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                play.animate().cancel()
                play.animate().scaleX(0.82f).scaleY(0.82f).setDuration(55L).withEndAction {
                    play.setImageResource(if (isPlaying) R.drawable.ic_player_pause else R.drawable.ic_player_play)
                    play.animate().scaleX(1f).scaleY(1f).setDuration(115L).start()
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
                        shell.scaleX = (1f - (dy.coerceAtLeast(0f) / root.height.coerceAtLeast(1)) * 0.15f)
                            .coerceIn(0.86f, 1f)
                        shell.scaleY = shell.scaleX
                        shell.alpha = (1f - (dy.coerceAtLeast(0f) / root.height.coerceAtLeast(1)) * 0.72f)
                            .coerceIn(0.50f, 1f)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    when {
                        !dragging -> {
                            view.performClick()
                            expandToWatchPage()
                        }
                        dy < -dp(activity, 72) && abs(dy) > abs(dx) * 0.75f -> expandToWatchPage()
                        dy > dp(activity, 132) && abs(dy) > abs(dx) * 0.72f -> {
                            shell.animate()
                                .alpha(0f)
                                .scaleX(0.78f)
                                .scaleY(0.78f)
                                .translationY(dp(activity, 120).toFloat())
                                .setDuration(145L)
                                .withEndAction { dismiss(releasePlayer = true) }
                                .start()
                        }
                        else -> {
                            val maxX = (root.width - shell.width).coerceAtLeast(0).toFloat()
                            val maxY = (root.height - shell.height).coerceAtLeast(0).toFloat()
                            val targetX = if (shell.x + shell.width / 2f < root.width / 2f) 0f else maxX
                            val targetY = shell.y.coerceIn(0f, maxY)
                            shell.animate()
                                .x(targetX)
                                .y(targetY)
                                .scaleX(1f)
                                .scaleY(1f)
                                .alpha(1f)
                                .setDuration(190L)
                                .start()
                        }
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    shell.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(140L).start()
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
        shell.scaleX = 0.72f
        shell.scaleY = 0.72f
        shell.translationY = dp(activity, 76).toFloat()
        shell.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setDuration(220L)
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
        expandCallback = null
        expanding = false
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
}
