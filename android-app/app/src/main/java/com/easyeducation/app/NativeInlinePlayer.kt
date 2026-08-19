@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Inline instance of the same native player shell used by fullscreen and offline playback.
 * YouTube adaptive streams are merged at MediaSource level, so online playback no longer depends on
 * a legacy single-file progressive format existing for the requested quality.
 */
@Composable
fun NativeInlinePlayer(
    classId: String,
    sourceUrl: String,
    online: Boolean,
    modifier: Modifier = Modifier,
    requestedHeight: Int = 480,
    title: String = "",
    onMinimize: (() -> Unit)? = null,
    onFullscreen: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val exoPlayer = remember(classId) { ExoPlayer.Builder(context).build() }
    var handedToMini by remember(exoPlayer) { mutableStateOf(false) }
    var loading by remember(classId, sourceUrl) { mutableStateOf(sourceUrl.isNotBlank() && online) }
    var errorText by remember(classId, sourceUrl) { mutableStateOf<String?>(null) }
    val progressKey = remember(classId) { "class:$classId" }

    DisposableEffect(exoPlayer, lifecycleOwner, progressKey) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    savePosition(context, progressKey, exoPlayer.currentPosition)
                    exoPlayer.pause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            savePosition(context, progressKey, exoPlayer.currentPosition)
            if (!handedToMini && !NativeMiniPlayerOverlay.owns(exoPlayer)) exoPlayer.release()
        }
    }

    LaunchedEffect(classId, sourceUrl, online, requestedHeight) {
        if (!online || sourceUrl.isBlank()) {
            loading = false
            exoPlayer.stop()
            return@LaunchedEffect
        }
        loading = true
        errorText = null
        val resolved = withContext(Dispatchers.IO) {
            runCatching {
                NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
            }
        }
        resolved.onSuccess { source ->
            runCatching {
                exoPlayer.setMediaSource(NativePlaybackSourceResolver.toMediaSource(source))
                val saved = context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
                    .getLong(progressKey, 0L)
                exoPlayer.prepare()
                if (saved > 0L) exoPlayer.seekTo(saved)
                exoPlayer.playWhenReady = true
            }.onFailure { error -> errorText = friendlyPlayerError(error.message) }
            loading = false
        }.onFailure { error ->
            loading = false
            errorText = friendlyPlayerError(error.message)
        }
    }

    fun minimizePlayer() {
        val activity = context.findActivity() ?: return
        savePosition(context, progressKey, exoPlayer.currentPosition)
        handedToMini = true
        NativeMiniPlayerOverlay.show(
            activity = activity,
            exoPlayer = exoPlayer,
            classId = classId,
            sourceUrl = sourceUrl,
            title = title,
            requestedHeight = requestedHeight,
        )
        onMinimize?.invoke()
    }

    // The same ExoPlayer is now rendering in the persistent overlay. Removing this slot makes the
    // watch page collapse upward instead of leaving a black 16:9 hole behind.
    if (handedToMini) return

    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                YoutubeStylePlayerView(ctx).apply {
                    bindPlayer(exoPlayer)
                    setTitle(title)
                    setLoading(loading)
                    this.onMinimize = { minimizePlayer() }
                    this.onFullscreen = {
                        onFullscreen?.invoke() ?: ctx.startActivity(
                            Intent(ctx, NativePlayerActivity::class.java)
                                .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, sourceUrl)
                                .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, classId)
                                .putExtra(NativePlayerActivity.EXTRA_HEIGHT, requestedHeight)
                                .putExtra(NativePlayerActivity.EXTRA_TITLE, title),
                        )
                    }
                }
            },
            update = { view ->
                view.bindPlayer(exoPlayer)
                view.setTitle(title)
                view.setLoading(loading)
                view.onMinimize = { minimizePlayer() }
                view.onFullscreen = {
                    onFullscreen?.invoke() ?: context.startActivity(
                        Intent(context, NativePlayerActivity::class.java)
                            .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, sourceUrl)
                            .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, classId)
                            .putExtra(NativePlayerActivity.EXTRA_HEIGHT, requestedHeight)
                            .putExtra(NativePlayerActivity.EXTRA_TITLE, title),
                    )
                }
            },
        )

        when {
            !online -> Text(
                "Offline • open the saved class from Downloads",
                color = Color.White,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(20.dp),
            )
            sourceUrl.isBlank() -> Text(
                "Video source is unavailable",
                color = Color.White,
                modifier = Modifier.padding(20.dp),
            )
            loading -> CircularProgressIndicator()
            errorText != null -> Text(
                errorText.orEmpty(),
                color = Color.White,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(20.dp),
            )
        }
    }
}

private fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return current as? Activity
}

private fun savePosition(context: Context, key: String, position: Long) {
    if (position <= 0L) return
    context.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
        .edit().putLong(key, position).apply()
}

private fun friendlyPlayerError(message: String?): String {
    val value = message.orEmpty()
    return when {
        value.contains("Unable to resolve host", true) ||
            value.contains("Failed to connect", true) ||
            value.contains("timeout", true) -> "Network problem. Check your connection and try again."
        value.contains("403", true) -> "Video access expired. Reopen the class to refresh the stream."
        value.isBlank() -> "Could not open this video."
        else -> value
    }
}

private const val PLAYER_PREFS = "native_player_positions_v2"
