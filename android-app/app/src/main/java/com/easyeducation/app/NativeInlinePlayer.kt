@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.ComponentActivity
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

/**
 * Inline surface for the process-local persistent player. Inline, fullscreen and miniplayer attach
 * to the same ExoPlayer instance, so changing presentation does not re-resolve YouTube/Rumble,
 * recreate the decoder or throw away buffered media.
 */
@Composable
fun NativeInlinePlayer(
    classId: String,
    sourceUrl: String,
    online: Boolean,
    modifier: Modifier = Modifier,
    requestedHeight: Int = 480,
    title: String = "",
    onBack: (() -> Unit)? = null,
    onMinimize: (() -> Unit)? = null,
    onFullscreen: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val exoPlayer = remember { PersistentNativePlayer.player(context) }
    var handedToMini by remember(classId) { mutableStateOf(false) }
    var handedToFullscreen by remember(classId) { mutableStateOf(false) }
    var loading by remember(classId, sourceUrl) { mutableStateOf(sourceUrl.isNotBlank() && online) }
    var errorText by remember(classId, sourceUrl) { mutableStateOf<String?>(null) }

    DisposableEffect(lifecycleOwner, classId) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    if (!handedToMini) handedToFullscreen = false
                }
                Lifecycle.Event.ON_STOP -> {
                    PersistentNativePlayer.savePosition(context)
                    if (!handedToMini && !handedToFullscreen) PersistentNativePlayer.pause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            PersistentNativePlayer.savePosition(context)
            if (!handedToMini && !handedToFullscreen &&
                PersistentNativePlayer.currentClassId() == classId
            ) {
                PersistentNativePlayer.pause()
            }
        }
    }

    LaunchedEffect(classId, sourceUrl, online, requestedHeight) {
        if (!online || sourceUrl.isBlank()) {
            loading = false
            errorText = if (sourceUrl.isBlank()) "Video source is unavailable" else null
            return@LaunchedEffect
        }
        loading = true
        errorText = null
        runCatching {
            PersistentNativePlayer.ensureOnline(
                context = context,
                classId = classId,
                sourceUrl = sourceUrl,
                requestedHeight = requestedHeight,
                autoPlay = true,
            )
        }.onSuccess {
            loading = false
        }.onFailure { error ->
            loading = false
            errorText = friendlyPlayerError(error.message)
        }
    }

    fun minimizePlayer() {
        val activity = context.findActivity() ?: return
        PersistentNativePlayer.savePosition(context)
        handedToMini = true
        handedToFullscreen = false
        NativeMiniPlayerOverlay.show(
            activity = activity,
            exoPlayer = exoPlayer,
            classId = classId,
            sourceUrl = sourceUrl,
            title = title,
            requestedHeight = requestedHeight,
        )
        if (onMinimize != null) onMinimize()
        else (activity as? ComponentActivity)?.onBackPressedDispatcher?.onBackPressed()
    }

    fun fullscreenPlayer() {
        val activity = context.findActivity() ?: return
        PersistentNativePlayer.savePosition(context)
        handedToFullscreen = true
        onFullscreen?.invoke() ?: run {
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
    }

    // Once minimized the player is physically rendering in the activity overlay, while the watch
    // route is popped. Do not leave a dead black 16:9 slot behind.
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
                    bindPlayer(if (handedToFullscreen) null else exoPlayer)
                    setTitle(title)
                    setLoading(loading)
                    this.onBack = {
                        onBack?.invoke()
                            ?: (ctx.findActivity() as? ComponentActivity)
                                ?.onBackPressedDispatcher?.onBackPressed()
                    }
                    this.onMinimize = { minimizePlayer() }
                    this.onFullscreen = { fullscreenPlayer() }
                }
            },
            update = { view ->
                view.bindPlayer(if (handedToFullscreen) null else exoPlayer)
                view.setTitle(title)
                view.setLoading(loading)
                view.onBack = {
                    onBack?.invoke()
                        ?: (context.findActivity() as? ComponentActivity)
                            ?.onBackPressedDispatcher?.onBackPressed()
                }
                view.onMinimize = { minimizePlayer() }
                view.onFullscreen = { fullscreenPlayer() }
            },
        )

        when {
            !online -> Text(
                "No internet • downloaded classes are available from Downloads",
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
