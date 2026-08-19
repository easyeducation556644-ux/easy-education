@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
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
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

@Composable
fun NativeInlinePlayer(
    classId: String,
    sourceUrl: String,
    online: Boolean,
    modifier: Modifier = Modifier,
    requestedHeight: Int = 480,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val exoPlayer = remember(classId) { ExoPlayer.Builder(context).build() }
    var loading by remember(classId, sourceUrl) { mutableStateOf(sourceUrl.isNotBlank() && online) }
    var errorText by remember(classId, sourceUrl) { mutableStateOf<String?>(null) }
    val progressKey = remember(classId) { "class:$classId" }

    DisposableEffect(exoPlayer, lifecycleOwner, progressKey) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_STOP -> {
                    if (exoPlayer.currentPosition > 0) {
                        context.getSharedPreferences(PLAYER_PREFS, android.content.Context.MODE_PRIVATE)
                            .edit().putLong(progressKey, exoPlayer.currentPosition).apply()
                    }
                    exoPlayer.pause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            if (exoPlayer.currentPosition > 0) {
                context.getSharedPreferences(PLAYER_PREFS, android.content.Context.MODE_PRIVATE)
                    .edit().putLong(progressKey, exoPlayer.currentPosition).apply()
            }
            exoPlayer.release()
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
        val result = withContext(Dispatchers.IO) {
            runCatching { resolveOnlineSource(classId, sourceUrl, requestedHeight) }
        }
        result.onSuccess { source ->
            runCatching {
                val mediaSource = source.toMediaSource(classId)
                exoPlayer.setMediaSource(mediaSource)
                val saved = context.getSharedPreferences(PLAYER_PREFS, android.content.Context.MODE_PRIVATE)
                    .getLong(progressKey, 0L)
                exoPlayer.prepare()
                if (saved > 0L) exoPlayer.seekTo(saved)
                exoPlayer.playWhenReady = true
            }.onFailure { error ->
                errorText = friendlyPlayerError(error.message)
            }
            loading = false
        }.onFailure { error ->
            loading = false
            errorText = friendlyPlayerError(error.message)
        }
    }

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
                PlayerView(ctx).apply {
                    useController = true
                    keepScreenOn = true
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    player = exoPlayer
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
            },
            update = { view -> view.player = exoPlayer },
        )
        when {
            !online -> Text(
                "Offline • saved videos are available from Downloads",
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

private sealed interface InlineOnlineSource {
    data class Direct(
        val url: String,
        val hls: Boolean = false,
        val referer: String? = null,
    ) : InlineOnlineSource

    data class RumbleProxy(
        val classId: String,
        val height: Int,
        val totalBytes: Long,
        val downloadToken: String,
    ) : InlineOnlineSource
}

private fun InlineOnlineSource.toMediaSource(classId: String): MediaSource = when (this) {
    is InlineOnlineSource.Direct -> {
        if (hls) {
            val requestProperties = mutableMapOf("User-Agent" to RUMBLE_USER_AGENT)
            referer?.takeIf { it.isNotBlank() }?.let {
                requestProperties["Referer"] = it
                requestProperties["Origin"] = "https://rumble.com"
            }
            val dataSourceFactory = DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(requestProperties)
            val item = MediaItem.Builder()
                .setUri(url)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
            HlsMediaSource.Factory(dataSourceFactory).createMediaSource(item)
        } else {
            ProgressiveMediaSource.Factory(DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true))
                .createMediaSource(MediaItem.fromUri(url))
        }
    }
    is InlineOnlineSource.RumbleProxy -> {
        ProgressiveMediaSource.Factory(
            RumbleProxyDataSource.Factory(
                classId = classId,
                height = height,
                totalBytes = totalBytes,
                downloadToken = downloadToken,
            ),
        ).createMediaSource(
            MediaItem.fromUri(Uri.parse("rumble-proxy://easy-education/$classId/$height")),
        )
    }
}

private fun resolveOnlineSource(classId: String, sourceUrl: String, requestedHeight: Int): InlineOnlineSource {
    return when {
        YoutubeDeviceResolver.isYoutubeUrl(sourceUrl) -> {
            val (_, format) = YoutubeDeviceResolver().pickFormat(sourceUrl, requestedHeight)
            InlineOnlineSource.Direct(format.url)
        }
        isRumblePage(sourceUrl) -> resolveRumbleSource(classId, sourceUrl, requestedHeight)
        sourceUrl.contains(".m3u8", ignoreCase = true) -> InlineOnlineSource.Direct(sourceUrl, hls = true)
        else -> InlineOnlineSource.Direct(sourceUrl)
    }
}

private fun resolveRumbleSource(classId: String, sourceUrl: String, requestedHeight: Int): InlineOnlineSource {
    val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
    val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
    val url = "$APP_ORIGIN/api/offline-video?options=1" +
        "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(sourceUrl)}"
    val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    val payload = http.newCall(
        Request.Builder().url(url).header("Authorization", "Bearer $token").build(),
    ).execute().use { response ->
        if (!response.isSuccessful) {
            val message = runCatching { JSONObject(response.body?.string().orEmpty()).optString("error") }.getOrNull()
            error(message?.takeIf { it.isNotBlank() } ?: "Video authorization failed (${response.code})")
        }
        JSONObject(response.body?.string().orEmpty())
    }
    val options = payload.optJSONArray("options") ?: error("No stream qualities are available")

    data class HlsChoice(val height: Int, val url: String)
    data class Mp4Choice(val height: Int, val bytes: Long)
    val hls = mutableListOf<HlsChoice>()
    val mp4 = mutableListOf<Mp4Choice>()
    for (index in 0 until options.length()) {
        val item = options.optJSONObject(index) ?: continue
        val height = item.optInt("height", 0)
        if (height <= 0) continue
        when (item.optString("kind")) {
            "hls" -> item.optString("playlistUrl").takeIf { it.isNotBlank() }?.let { hls += HlsChoice(height, it) }
            "mp4" -> item.optLong("contentLength", 0L).takeIf { it > 0L }?.let { mp4 += Mp4Choice(height, it) }
        }
    }

    fun <T> choose(items: List<T>, heightOf: (T) -> Int): T? =
        items.firstOrNull { heightOf(it) == requestedHeight }
            ?: items.filter { heightOf(it) <= requestedHeight }.maxByOrNull(heightOf)
            ?: items.minByOrNull(heightOf)

    choose(hls) { it.height }?.let { selected ->
        return InlineOnlineSource.Direct(selected.url, hls = true, referer = sourceUrl)
    }
    val selectedMp4 = choose(mp4) { it.height }
        ?: error("No native Rumble stream is available")
    val downloadToken = payload.optString("downloadToken")
    require(downloadToken.isNotBlank()) { "Playback authorization expired. Reopen the class." }
    return InlineOnlineSource.RumbleProxy(classId, selectedMp4.height, selectedMp4.bytes, downloadToken)
}

private fun isRumblePage(value: String): Boolean = runCatching {
    val host = URI(value).host?.lowercase().orEmpty()
    host == "rumble.com" || host.endsWith(".rumble.com")
}.getOrDefault(false)

private fun friendlyPlayerError(message: String?): String {
    val value = message.orEmpty()
    return when {
        value.contains("Unable to resolve host", true) ||
            value.contains("Failed to connect", true) ||
            value.contains("timeout", true) -> "Network problem. Check your connection and try again."
        value.isBlank() -> "Could not open this video."
        else -> value
    }
}

private const val PLAYER_PREFS = "native_player_positions_v2"
private const val APP_ORIGIN = "https://easy-education.vercel.app"
private const val RUMBLE_USER_AGENT =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"
