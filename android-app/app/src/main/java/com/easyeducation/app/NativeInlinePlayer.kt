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
 * Inline presentation of the single process-local player session and the single visual player view.
 * Inline, mini, native PiP and fullscreen reparent that same YoutubeStylePlayerView. Presentation
 * changes therefore do not call resolver/setMediaSource/prepare and do not bind a second PlayerView.
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

    fun configureInlineSurface(surface: YoutubeStylePlayerView, ctx: Context) {
        surface.setFullscreenPresentation(false)
        surface.bindPlayer(exoPlayer)
        surface.setTitle(title)
        surface.setLoading(loading)
        surface.setNavigationAvailability(hasPrevious, hasNext)
        surface.onBack = {
            onBack?.invoke()
                ?: (ctx.findActivity() as? ComponentActivity)?.onBackPressedDispatcher?.onBackPressed()
        }
        surface.onPrevious = onPrevious
        surface.onNext = onNext
        surface.onMinimize = minimize@{
            val activity = ctx.findActivity() ?: return@minimize
            val host = hostRef.get()
            val handoff = host?.claimMiniPlayerHandoff()
            val sourceBounds = handoff?.bounds ?: host?.globalBounds()
            PersistentNativePlayer.savePosition(ctx)
            handedToMini = true
            handedToFullscreen = false
            NativeMiniPlayerOverlay.show(
                activity = activity,
                exoPlayer = exoPlayer,
                classId = classId,
                sourceUrl = sourceUrl,
                title = title,
                requestedHeight = requestedHeight,
                sourceBounds = sourceBounds,
                handoff = handoff,
                onExpandToWatchPage = onExpandFromMini,
            )
            if (onMinimize != null) onMinimize()
            else (activity as? ComponentActivity)?.onBackPressedDispatcher?.onBackPressed()
        }
        surface.onFullscreen = fullscreen@{
            val activity = ctx.findActivity() ?: return@fullscreen
            val host = hostRef.get()
            PersistentNativePlayer.savePosition(ctx)
            handedToMini = false
            handedToFullscreen = true
            NativeFullscreenOverlay.show(
                activity = activity,
                exoPlayer = exoPlayer,
                classId = classId,
                sourceUrl = sourceUrl,
                title = title,
                requestedHeight = requestedHeight,
                sourceBounds = host?.globalBounds(),
            ) { activeId ->
                handedToFullscreen = false
                if (activeId.isNotBlank() && activeId != classId) {
                    onSharedSessionClassChanged?.invoke(activeId)
                } else if (!NativeInlineSurfaceRegistry.restore(exoPlayer)) {
                    hostRef.get()?.let { inlineHost ->
                        configureInlineSurface(inlineHost.attachSharedSurface(), ctx)
                        inlineHost.resetPagePresentation()
                    }
                }
            }
            if (NativeFullscreenOverlay.owns(exoPlayer)) onFullscreen?.invoke()
            else handedToFullscreen = false
        }
    }

    DisposableEffect(lifecycleOwner, classId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                PersistentNativePlayer.savePosition(context)
                if (
                    !handedToMini && !handedToFullscreen &&
                    !NativeFullscreenOverlay.owns(exoPlayer) &&
                    !NativeMiniPlayerOverlay.owns(exoPlayer)
                ) {
                    PersistentNativePlayer.pause()
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            NativeInlineSurfaceRegistry.unregister(hostRef.get())
            PersistentNativePlayer.savePosition(context)
            if (
                !handedToMini && !handedToFullscreen &&
                !NativeFullscreenOverlay.owns(exoPlayer) &&
                !NativeMiniPlayerOverlay.owns(exoPlayer) &&
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
                    val configure: (YoutubeStylePlayerView) -> Unit = { surface -> configureInlineSurface(surface, ctx) }
                    NativeInlineSurfaceRegistry.register(this, classId, configure)
                    if (!NativeFullscreenOverlay.owns(exoPlayer) && !NativeMiniPlayerOverlay.owns(exoPlayer)) {
                        configure(attachSharedSurface())
                    }
                }
            },
            update = { host ->
                hostRef.set(host)
                val configure: (YoutubeStylePlayerView) -> Unit = { surface -> configureInlineSurface(surface, context) }
                NativeInlineSurfaceRegistry.register(host, classId, configure)
                if (
                    !handedToFullscreen &&
                    !NativeFullscreenOverlay.owns(exoPlayer) &&
                    !NativeMiniPlayerOverlay.owns(exoPlayer)
                ) {
                    configure(host.attachSharedSurface())
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
