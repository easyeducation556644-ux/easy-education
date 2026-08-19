@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
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
import java.util.concurrent.atomic.AtomicReference

/**
 * Inline presentation of the single process-local player session. Inline -> mini -> watch page and
 * inline -> fullscreen -> inline never re-resolve or re-prepare the current media item. Only a real
 * class change replaces the MediaSource.
 */
@Composable
fun NativeInlinePlayer(
    classId: String,
    sourceUrl: String,
    online: Boolean,
    modifier: Modifier = Modifier,
    requestedHeight: Int = 480,
    title: String = "",
    hasPrevious: Boolean = false,
    hasNext: Boolean = false,
    onPrevious: (() -> Unit)? = null,
    onNext: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    onMinimize: (() -> Unit)? = null,
    onExpandFromMini: (() -> Unit)? = null,
    onFullscreen: (() -> Unit)? = null,
    onSharedSessionClassChanged: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val exoPlayer = remember { PersistentNativePlayer.player(context) }
    val hostRef = remember { AtomicReference<YoutubeWatchGestureHost?>() }

    val preparedAtEntry = remember(classId, sourceUrl, requestedHeight) {
        PersistentNativePlayer.matches(classId, sourceUrl, requestedHeight) && exoPlayer.mediaItemCount > 0
    }
    var handedToMini by remember(classId) { mutableStateOf(false) }
    var handedToFullscreen by remember(classId) { mutableStateOf(false) }
    var loading by remember(classId, sourceUrl, requestedHeight) {
        mutableStateOf(sourceUrl.isNotBlank() && online && !preparedAtEntry)
    }
    var errorText by remember(classId, sourceUrl) { mutableStateOf<String?>(null) }

    DisposableEffect(lifecycleOwner, classId) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    PersistentNativePlayer.savePosition(context)
                    if (!handedToMini && !handedToFullscreen && !NativeFullscreenOverlay.owns(exoPlayer)) {
                        PersistentNativePlayer.pause()
                    }
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            PersistentNativePlayer.savePosition(context)
            if (
                !handedToMini && !handedToFullscreen &&
                !NativeFullscreenOverlay.owns(exoPlayer) &&
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

        val alreadyPrepared = PersistentNativePlayer.matches(classId, sourceUrl, requestedHeight) &&
            exoPlayer.mediaItemCount > 0
        NativeMiniPlayerOverlay.dismiss(releasePlayer = false)
        handedToMini = false
        if (alreadyPrepared) {
            loading = false
            errorText = null
            exoPlayer.playWhenReady = true
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
        val host = hostRef.get()
        val sourceBounds = host?.globalBounds()
        PersistentNativePlayer.savePosition(context)
        handedToMini = true
        handedToFullscreen = false
        host?.resetPagePresentation()
        NativeMiniPlayerOverlay.show(
            activity = activity,
            exoPlayer = exoPlayer,
            classId = classId,
            sourceUrl = sourceUrl,
            title = title,
            requestedHeight = requestedHeight,
            sourceBounds = sourceBounds,
            onExpandToWatchPage = onExpandFromMini,
        )
        if (onMinimize != null) onMinimize()
        else (activity as? ComponentActivity)?.onBackPressedDispatcher?.onBackPressed()
    }

    fun fullscreenPlayer() {
        val activity = context.findActivity() ?: return
        val host = hostRef.get()
        PersistentNativePlayer.savePosition(context)
        handedToMini = false
        handedToFullscreen = true
        val bounds = host?.globalBounds()
        host?.playerSurface?.bindPlayer(null)
        NativeFullscreenOverlay.show(
            activity = activity,
            exoPlayer = exoPlayer,
            classId = classId,
            sourceUrl = sourceUrl,
            title = title,
            requestedHeight = requestedHeight,
            sourceBounds = bounds,
        ) { activeId ->
            handedToFullscreen = false
            hostRef.get()?.resetPagePresentation()
            if (activeId.isNotBlank() && activeId != classId) {
                onSharedSessionClassChanged?.invoke(activeId)
            }
        }
        if (!NativeFullscreenOverlay.owns(exoPlayer)) {
            handedToFullscreen = false
            host?.playerSurface?.bindPlayer(exoPlayer)
        } else {
            onFullscreen?.invoke()
        }
    }

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
                YoutubeWatchGestureHost(ctx).apply {
                    hostRef.set(this)
                    playerSurface.apply {
                        setFullscreenPresentation(false)
                        bindPlayer(if (handedToFullscreen || NativeFullscreenOverlay.owns(exoPlayer)) null else exoPlayer)
                        setTitle(title)
                        setLoading(loading)
                        setNavigationAvailability(hasPrevious, hasNext)
                        this.onBack = {
                            onBack?.invoke()
                                ?: (ctx.findActivity() as? ComponentActivity)
                                    ?.onBackPressedDispatcher?.onBackPressed()
                        }
                        this.onPrevious = onPrevious
                        this.onNext = onNext
                        this.onMinimize = { minimizePlayer() }
                        this.onFullscreen = { fullscreenPlayer() }
                    }
                }
            },
            update = { host ->
                hostRef.set(host)
                host.playerSurface.apply {
                    setFullscreenPresentation(false)
                    bindPlayer(if (handedToFullscreen || NativeFullscreenOverlay.owns(exoPlayer)) null else exoPlayer)
                    setTitle(title)
                    setLoading(loading)
                    setNavigationAvailability(hasPrevious, hasNext)
                    this.onBack = {
                        onBack?.invoke()
                            ?: (context.findActivity() as? ComponentActivity)
                                ?.onBackPressedDispatcher?.onBackPressed()
                    }
                    this.onPrevious = onPrevious
                    this.onNext = onNext
                    this.onMinimize = { minimizePlayer() }
                    this.onFullscreen = { fullscreenPlayer() }
                }
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
