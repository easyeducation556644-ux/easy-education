package com.easyeducation.app

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
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
 * Builds Media3 sources for native class playback.
 *
 * YouTube is intentionally resolved to either a progressive stream or a synchronized adaptive
 * video+audio pair. This is separate from the offline muxer: Media3 merges the two tracks only for
 * playback, so an adaptive-only YouTube video no longer fails with "No single-file stream".
 */
@UnstableApi
class NativeOnlineMediaSourceResolver(
    private val context: Context,
) {
    fun resolve(classId: String, sourceUrl: String, requestedHeight: Int): MediaSource {
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(sourceUrl) -> resolveYouTube(sourceUrl, requestedHeight)
            isRumblePage(sourceUrl) -> resolveRumble(classId, sourceUrl, requestedHeight)
            sourceUrl.contains(".m3u8", ignoreCase = true) -> hlsSource(sourceUrl)
            else -> progressiveSource(sourceUrl)
        }
    }

    private fun resolveYouTube(sourceUrl: String, requestedHeight: Int): MediaSource {
        val result = YoutubeDeviceResolver().resolve(sourceUrl)
        val variant = result.variants.firstOrNull { it.height == requestedHeight }
            ?: result.variants.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
            ?: result.variants.minByOrNull { it.height }
            ?: error("YouTube did not expose a playable stream")

        variant.progressive?.let { return youtubeProgressiveSource(it) }
        val video = variant.video ?: error("YouTube video track is unavailable")
        val audio = variant.audio ?: error("YouTube audio track is unavailable")
        return MergingMediaSource(
            youtubeProgressiveSource(video),
            youtubeProgressiveSource(audio),
        )
    }

    private fun youtubeProgressiveSource(format: YoutubeDeviceResolver.Format): MediaSource {
        val headers = linkedMapOf(
            "User-Agent" to format.userAgent,
            "Referer" to format.referer,
            "Accept-Encoding" to "identity",
            "Accept-Language" to "en-US,en;q=0.9",
        )
        val factory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(headers)
        val item = MediaItem.Builder()
            .setUri(format.url)
            .setMimeType(format.mimeType.takeIf { it.isNotBlank() })
            .build()
        return ProgressiveMediaSource.Factory(factory).createMediaSource(item)
    }

    private fun resolveRumble(classId: String, sourceUrl: String, requestedHeight: Int): MediaSource {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val endpoint = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(sourceUrl)}"
        val http = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        val payload = http.newCall(
            Request.Builder().url(endpoint).header("Authorization", "Bearer $token").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) {
                val message = runCatching {
                    JSONObject(response.body?.string().orEmpty()).optString("error")
                }.getOrNull()
                error(message?.takeIf { it.isNotBlank() } ?: "Rumble video authorization failed (${response.code})")
            }
            JSONObject(response.body?.string().orEmpty())
        }

        data class HlsChoice(val height: Int, val url: String)
        data class Mp4Choice(val height: Int, val bytes: Long)
        val hls = mutableListOf<HlsChoice>()
        val mp4 = mutableListOf<Mp4Choice>()
        val options = payload.optJSONArray("options") ?: error("No Rumble stream qualities are available")
        for (index in 0 until options.length()) {
            val item = options.optJSONObject(index) ?: continue
            val height = item.optInt("height", 0)
            if (height <= 0) continue
            when (item.optString("kind")) {
                "hls" -> item.optString("playlistUrl").takeIf { it.isNotBlank() }
                    ?.let { hls += HlsChoice(height, it) }
                "mp4" -> item.optLong("contentLength", 0L).takeIf { it > 0L }
                    ?.let { mp4 += Mp4Choice(height, it) }
            }
        }

        fun <T> choose(items: List<T>, heightOf: (T) -> Int): T? =
            items.firstOrNull { heightOf(it) == requestedHeight }
                ?: items.filter { heightOf(it) <= requestedHeight }.maxByOrNull(heightOf)
                ?: items.minByOrNull(heightOf)

        choose(hls) { it.height }?.let { selected ->
            val headers = mapOf(
                "User-Agent" to RUMBLE_USER_AGENT,
                "Referer" to sourceUrl,
                "Origin" to "https://rumble.com",
            )
            val factory = DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(headers)
            val item = MediaItem.Builder()
                .setUri(selected.url)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
            return HlsMediaSource.Factory(factory).createMediaSource(item)
        }

        val selected = choose(mp4) { it.height }
            ?: error("Rumble did not expose a native HLS or progressive stream")
        val downloadToken = payload.optString("downloadToken")
        require(downloadToken.isNotBlank()) { "Rumble playback authorization expired. Reopen the class." }
        return ProgressiveMediaSource.Factory(
            RumbleProxyDataSource.Factory(
                classId = classId,
                height = selected.height,
                totalBytes = selected.bytes,
                downloadToken = downloadToken,
            ),
        ).createMediaSource(
            MediaItem.fromUri(Uri.parse("rumble-proxy://easy-education/$classId/${selected.height}")),
        )
    }

    private fun hlsSource(url: String): MediaSource {
        val factory = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
        val item = MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build()
        return HlsMediaSource.Factory(factory).createMediaSource(item)
    }

    private fun progressiveSource(url: String): MediaSource {
        val factory = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
        return ProgressiveMediaSource.Factory(factory).createMediaSource(MediaItem.fromUri(url))
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        private const val RUMBLE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"
    }
}
