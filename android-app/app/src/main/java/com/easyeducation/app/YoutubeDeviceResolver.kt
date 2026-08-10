package com.easyeducation.app

import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Small device-side YouTube resolver used only for offline copies of course videos.
 *
 * It intentionally accepts only progressive MP4 streams (audio + video in one file).
 * That keeps the low-memory path simple: no Python, ffmpeg, large buffers, or adaptive
 * video/audio muxing on the student's phone.
 */
class YoutubeDeviceResolver(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .callTimeout(28, TimeUnit.SECONDS)
        .followRedirects(true)
        .build(),
) {
    data class Format(
        val height: Int,
        val qualityLabel: String,
        val url: String,
        val contentLength: Long,
        val mimeType: String,
        val bitrate: Long,
    )

    data class Result(
        val videoId: String,
        val title: String,
        val formats: List<Format>,
    ) {
        val recommendedHeight: Int
            get() = formats.filter { it.height <= 480 }.maxOfOrNull { it.height }
                ?: formats.minOfOrNull { it.height }
                ?: 360
    }

    private data class ClientProfile(
        val name: String,
        val version: String,
        val userAgent: String,
        val extra: JSONObject.() -> Unit,
    )

    fun resolve(videoUrl: String): Result {
        val videoId = extractVideoId(videoUrl)
            ?: throw IllegalArgumentException("Invalid YouTube video URL")
        val visitorData = runCatching { fetchVisitorData(videoId) }.getOrNull()

        val profiles = listOf(
            ClientProfile(
                name = "IOS",
                version = "21.03.2",
                userAgent = "com.google.ios.youtube/21.03.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X; en_US)",
            ) {
                put("deviceMake", "Apple")
                put("deviceModel", "iPhone16,2")
                put("osName", "iOS")
                put("osVersion", "18.7.2.22H124")
            },
            ClientProfile(
                name = "ANDROID",
                version = "21.03.36",
                userAgent = "com.google.android.youtube/21.03.36 (Linux; U; Android 16; en_US) gzip",
            ) {
                put("androidSdkVersion", 36)
                put("osName", "Android")
                put("osVersion", "16")
            },
        )

        var lastReason = "No downloadable progressive MP4 stream was returned"
        for (profile in profiles) {
            val response = runCatching {
                requestPlayer(videoId, visitorData, profile)
            }.getOrElse {
                lastReason = it.message ?: lastReason
                null
            } ?: continue

            val status = response.optJSONObject("playabilityStatus")
            if (status?.optString("status") != "OK") {
                lastReason = status?.optString("reason")
                    ?.takeIf { it.isNotBlank() }
                    ?: status?.optJSONArray("messages")?.optString(0)
                    ?: lastReason
                continue
            }

            val title = response.optJSONObject("videoDetails")?.optString("title")
                ?.takeIf { it.isNotBlank() }
                ?: "YouTube class video"
            val formats = parseProgressiveFormats(response.optJSONObject("streamingData"))
            if (formats.isNotEmpty()) return Result(videoId, title, formats)
        }

        throw IllegalStateException(
            "$lastReason. YouTube may require a newer device resolver for this video.",
        )
    }

    fun pickFormat(videoUrl: String, requestedHeight: Int): Pair<Result, Format> {
        val result = resolve(videoUrl)
        val exact = result.formats.firstOrNull { it.height == requestedHeight }
        val below = result.formats.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
        val selected = exact ?: below ?: result.formats.minByOrNull { it.height }
            ?: throw IllegalStateException("No downloadable MP4 format")
        return result to selected
    }

    private fun requestPlayer(
        videoId: String,
        visitorData: String?,
        profile: ClientProfile,
    ): JSONObject {
        val client = JSONObject()
            .put("clientName", profile.name)
            .put("clientVersion", profile.version)
            .put("hl", "en")
            .put("gl", "US")
            .put("utcOffsetMinutes", 0)
        profile.extra(client)
        if (!visitorData.isNullOrBlank()) client.put("visitorData", visitorData)

        val body = JSONObject()
            .put("context", JSONObject().put("client", client))
            .put("videoId", videoId)
            .put("contentCheckOk", true)
            .put("racyCheckOk", true)
            .put(
                "playbackContext",
                JSONObject().put(
                    "contentPlaybackContext",
                    JSONObject().put("html5Preference", "HTML5_PREF_WANTS"),
                ),
            )

        val endpoint = buildString {
            append("https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false")
            append("&t=")
            append(randomToken(12))
            append("&id=")
            append(videoId)
        }
        val requestBuilder = Request.Builder()
            .url(endpoint)
            .header("User-Agent", profile.userAgent)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("X-Goog-Api-Format-Version", "2")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
        if (!visitorData.isNullOrBlank()) {
            requestBuilder.header("X-Goog-Visitor-Id", visitorData)
        }

        http.newCall(requestBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) error("YouTube resolver HTTP ${response.code}")
            val text = readBodyLimited(response.body?.byteStream(), PLAYER_RESPONSE_LIMIT)
            if (text.isBlank()) error("YouTube returned an empty player response")
            return JSONObject(text)
        }
    }

    private fun parseProgressiveFormats(streamingData: JSONObject?): List<Format> {
        val formats = streamingData?.optJSONArray("formats") ?: JSONArray()
        val byHeight = linkedMapOf<Int, Format>()

        for (index in 0 until formats.length()) {
            val item = formats.optJSONObject(index) ?: continue
            val url = item.optString("url")
            if (!isAllowedGoogleVideoUrl(url)) continue

            val mimeType = item.optString("mimeType")
            if (!mimeType.startsWith("video/mp4", ignoreCase = true)) continue
            // Progressive MP4 must contain both video and audio codecs.
            if (!mimeType.contains("avc1", ignoreCase = true) ||
                !mimeType.contains("mp4a", ignoreCase = true)) continue

            val height = item.optInt("height", 0)
            if (height <= 0 || height > MAX_LOW_MEMORY_HEIGHT) continue
            val bitrate = item.optLong("bitrate", 0L)
            var contentLength = item.optString("contentLength").toLongOrNull() ?: 0L
            if (contentLength <= 0L) {
                contentLength = runCatching { probeContentLength(url) }.getOrDefault(0L)
            }

            val candidate = Format(
                height = height,
                qualityLabel = item.optString("qualityLabel").ifBlank { "${height}p" },
                url = url,
                contentLength = contentLength,
                mimeType = mimeType.substringBefore(';'),
                bitrate = bitrate,
            )
            val previous = byHeight[height]
            if (previous == null || candidate.bitrate > previous.bitrate) {
                byHeight[height] = candidate
            }
        }

        return byHeight.values.sortedBy { it.height }
    }

    private fun probeContentLength(url: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", DOWNLOAD_USER_AGENT)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val contentRange = response.header("Content-Range").orEmpty()
            val total = contentRange.substringAfterLast('/', "").toLongOrNull()
            return total ?: response.body?.contentLength()?.takeIf { it > 1 } ?: 0L
        }
    }

    private fun fetchVisitorData(videoId: String): String? {
        val request = Request.Builder()
            .url("https://www.youtube.com/watch?v=$videoId&hl=en")
            .header("User-Agent", WEB_USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val html = readBodyLimited(response.body?.byteStream(), WATCH_PAGE_LIMIT)
            return VISITOR_PATTERNS.firstNotNullOfOrNull { pattern ->
                pattern.find(html)?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }
            }
        }
    }

    private fun readBodyLimited(input: java.io.InputStream?, maxBytes: Int): String {
        if (input == null) return ""
        input.use { stream ->
            val builder = StringBuilder(minOf(maxBytes, 64 * 1024))
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (total < maxBytes) {
                val allowed = minOf(buffer.size, maxBytes - total)
                val count = stream.read(buffer, 0, allowed)
                if (count <= 0) break
                builder.append(String(buffer, 0, count, Charsets.UTF_8))
                total += count
            }
            return builder.toString()
        }
    }

    private fun isAllowedGoogleVideoUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        val host = uri.host?.lowercase() ?: return false
        uri.scheme == "https" && (host == "googlevideo.com" || host.endsWith(".googlevideo.com"))
    }.getOrDefault(false)

    private fun randomToken(length: Int): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        return buildString(length) {
            repeat(length) { append(alphabet[RANDOM.nextInt(alphabet.length)]) }
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val RANDOM = SecureRandom()
        private const val MAX_LOW_MEMORY_HEIGHT = 720
        private const val WATCH_PAGE_LIMIT = 768 * 1024
        private const val PLAYER_RESPONSE_LIMIT = 2 * 1024 * 1024
        private const val WEB_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Mobile Safari/537.36"
        const val DOWNLOAD_USER_AGENT =
            "com.google.android.youtube/21.03.36 (Linux; U; Android 16; en_US) gzip"

        private val VISITOR_PATTERNS = listOf(
            Regex("\\\"VISITOR_DATA\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
            Regex("\\\"visitorData\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
        )

        fun extractVideoId(value: String): String? = runCatching {
            val uri = Uri.parse(value.trim())
            val host = uri.host?.lowercase().orEmpty().removePrefix("www.").removePrefix("m.")
            val candidate = when {
                host == "youtu.be" -> uri.pathSegments.firstOrNull()
                host == "youtube.com" || host.endsWith(".youtube.com") -> {
                    uri.getQueryParameter("v")
                        ?: uri.pathSegments.let { parts ->
                            if (parts.firstOrNull() in setOf("shorts", "embed", "live")) {
                                parts.getOrNull(1)
                            } else null
                        }
                }
                else -> null
            }?.trim()
            candidate?.takeIf { VIDEO_ID.matches(it) }
        }.getOrNull()

        fun isYoutubeUrl(value: String): Boolean = extractVideoId(value) != null

        private val VIDEO_ID = Regex("^[A-Za-z0-9_-]{6,20}$")
    }
}
