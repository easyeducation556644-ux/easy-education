@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package com.easyeducation.app

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * One resolver for the native player. YouTube, Rumble and ordinary direct sources all end up as a
 * Media3 MediaSource so the UI/control layer never needs to know which provider is underneath it.
 */
sealed interface NativeOnlinePlaybackSource {
    data class Direct(
        val url: String,
        val hls: Boolean = false,
        val requestHeaders: Map<String, String> = emptyMap(),
    ) : NativeOnlinePlaybackSource

    data class YoutubeAdaptive(
        val video: YoutubeDeviceResolver.Format,
        val audio: YoutubeDeviceResolver.Format,
    ) : NativeOnlinePlaybackSource

    data class RumbleProxy(
        val classId: String,
        val height: Int,
        val totalBytes: Long,
        val downloadToken: String,
    ) : NativeOnlinePlaybackSource
}

object NativePlaybackSourceResolver {
    private const val APP_ORIGIN = "https://easy-education.vercel.app"
    private const val RUMBLE_USER_AGENT = NativeRumbleDirectResolver.RUMBLE_USER_AGENT

    fun resolveOnline(
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
    ): NativeOnlinePlaybackSource {
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(sourceUrl) -> resolveYoutube(sourceUrl, requestedHeight)
            isRumblePage(sourceUrl) -> resolveRumble(classId, sourceUrl, requestedHeight)
            sourceUrl.contains(".m3u8", ignoreCase = true) -> NativeOnlinePlaybackSource.Direct(
                url = sourceUrl,
                hls = true,
            )
            else -> NativeOnlinePlaybackSource.Direct(sourceUrl)
        }
    }

    private fun resolveYoutube(sourceUrl: String, requestedHeight: Int): NativeOnlinePlaybackSource {
        val result = YoutubeDeviceResolver().resolve(sourceUrl)
        val selected = result.variants.firstOrNull { it.height == requestedHeight }
            ?: result.variants.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
            ?: result.variants.minByOrNull { it.height }
            ?: error("YouTube did not expose a playable stream for this video")

        selected.progressive?.let { format ->
            return NativeOnlinePlaybackSource.Direct(
                url = format.url,
                requestHeaders = youtubeHeaders(format),
            )
        }
        val video = selected.video
        val audio = selected.audio
        if (video != null && audio != null) {
            return NativeOnlinePlaybackSource.YoutubeAdaptive(video, audio)
        }
        result.hlsUrl?.takeIf { it.isNotBlank() }?.let { hls ->
            return NativeOnlinePlaybackSource.Direct(hls, hls = true)
        }
        error("YouTube did not expose a playable stream for this video")
    }

    fun toMediaSource(source: NativeOnlinePlaybackSource): MediaSource = when (source) {
        is NativeOnlinePlaybackSource.Direct -> {
            val factory = DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(source.requestHeaders)
            if (source.hls) {
                HlsMediaSource.Factory(factory).createMediaSource(
                    MediaItem.Builder()
                        .setUri(source.url)
                        .setMimeType(MimeTypes.APPLICATION_M3U8)
                        .build(),
                )
            } else {
                ProgressiveMediaSource.Factory(factory).createMediaSource(MediaItem.fromUri(source.url))
            }
        }

        is NativeOnlinePlaybackSource.YoutubeAdaptive -> {
            val videoFactory = DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(youtubeHeaders(source.video))
            val audioFactory = DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(youtubeHeaders(source.audio))
            val videoSource = ProgressiveMediaSource.Factory(videoFactory)
                .createMediaSource(MediaItem.fromUri(source.video.url))
            val audioSource = ProgressiveMediaSource.Factory(audioFactory)
                .createMediaSource(MediaItem.fromUri(source.audio.url))
            MergingMediaSource(videoSource, audioSource)
        }

        is NativeOnlinePlaybackSource.RumbleProxy -> {
            ProgressiveMediaSource.Factory(
                RumbleProxyDataSource.Factory(
                    classId = source.classId,
                    height = source.height,
                    totalBytes = source.totalBytes,
                    downloadToken = source.downloadToken,
                ),
            ).createMediaSource(
                MediaItem.fromUri(
                    Uri.parse("rumble-proxy://easy-education/${source.classId}/${source.height}"),
                ),
            )
        }
    }

    private fun youtubeHeaders(format: YoutubeDeviceResolver.Format): Map<String, String> = buildMap {
        put("User-Agent", format.userAgent)
        put("Accept-Encoding", "identity")
        format.referer.takeIf { it.isNotBlank() }?.let { put("Referer", it) }
        format.clientId.takeIf { it.isNotBlank() }?.let { put("X-YouTube-Client-Name", it) }
        format.clientVersion.takeIf { it.isNotBlank() }?.let { put("X-YouTube-Client-Version", it) }
    }

    /**
     * Native playback resolves Rumble on-device first. The previous implementation required the
     * production Vercel API even to start playback, so an APK built from a newer agent branch could
     * still fail whenever the web deployment lagged behind. The authenticated service is retained
     * as a fallback and for the existing secure MP4 proxy contract.
     */
    private fun resolveRumble(
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
    ): NativeOnlinePlaybackSource {
        val directAttempt = runCatching {
            NativeRumbleDirectResolver().resolve(sourceUrl, requestedHeight)
        }
        directAttempt.getOrNull()?.let { stream ->
            return NativeOnlinePlaybackSource.Direct(
                url = stream.url,
                hls = stream.hls,
                requestHeaders = rumbleHeaders(sourceUrl),
            )
        }

        return runCatching {
            resolveRumbleViaService(classId, sourceUrl, requestedHeight)
        }.getOrElse { serviceError ->
            val directMessage = directAttempt.exceptionOrNull()?.message.orEmpty()
                .ifBlank { "direct resolver failed" }
            val fallbackMessage = serviceError.message.orEmpty().ifBlank { "service fallback failed" }
            error("Rumble playback unavailable. Direct: $directMessage. Fallback: $fallbackMessage")
        }
    }

    private fun rumbleHeaders(sourceUrl: String): Map<String, String> = linkedMapOf(
        "User-Agent" to RUMBLE_USER_AGENT,
        "Referer" to sourceUrl,
        "Origin" to "https://rumble.com",
        "Accept-Encoding" to "identity",
        "Accept-Language" to "en-US,en;q=0.9",
    )

    private fun resolveRumbleViaService(
        classId: String,
        sourceUrl: String,
        requestedHeight: Int,
    ): NativeOnlinePlaybackSource {
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
                val message = runCatching {
                    JSONObject(response.body?.string().orEmpty()).optString("error")
                }.getOrNull()
                error(message?.takeIf { it.isNotBlank() }
                    ?: "Video authorization failed (${response.code})")
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
                "hls" -> item.optString("playlistUrl")
                    .takeIf { it.isNotBlank() }
                    ?.let { hls += HlsChoice(height, it) }
                "mp4" -> item.optLong("contentLength", 0L)
                    .takeIf { it > 0L }
                    ?.let { mp4 += Mp4Choice(height, it) }
            }
        }

        fun <T> choose(items: List<T>, heightOf: (T) -> Int): T? =
            items.firstOrNull { heightOf(it) == requestedHeight }
                ?: items.filter { heightOf(it) <= requestedHeight }.maxByOrNull(heightOf)
                ?: items.minByOrNull(heightOf)

        choose(hls) { it.height }?.let { selected ->
            return NativeOnlinePlaybackSource.Direct(
                url = selected.url,
                hls = true,
                requestHeaders = rumbleHeaders(sourceUrl),
            )
        }

        val selectedMp4 = choose(mp4) { it.height }
            ?: error("No native Rumble stream is available")
        val downloadToken = payload.optString("downloadToken")
        require(downloadToken.isNotBlank()) { "Playback authorization expired. Reopen the class." }
        return NativeOnlinePlaybackSource.RumbleProxy(
            classId = classId,
            height = selectedMp4.height,
            totalBytes = selectedMp4.bytes,
            downloadToken = downloadToken,
        )
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)
}
