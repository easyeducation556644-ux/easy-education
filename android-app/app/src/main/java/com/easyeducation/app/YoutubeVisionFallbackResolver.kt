package com.easyeducation.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.SecureRandom

/**
 * Narrow fallback used only when NewPipe's primary resolver fails with the known
 * "VisionOs response is not valid" client-response error. It deliberately resolves only direct,
 * progressive MP4 streams, so a video that succeeds through NewPipe never touches this code.
 */
class YoutubeVisionFallbackResolver(private val http: OkHttpClient) {
    private data class ClientProfile(
        val name: String,
        val version: String,
        val userAgent: String,
        val extra: JSONObject.() -> Unit,
    )

    private data class Attempt(val visitorData: String?, val region: String)

    fun resolve(videoId: String): YoutubeDeviceResolver.Result {
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
        val attempts = buildList {
            add(Attempt(visitorData, "US"))
            if (!visitorData.isNullOrBlank()) add(Attempt(null, "US"))
            add(Attempt(visitorData, "BD"))
            if (!visitorData.isNullOrBlank()) add(Attempt(null, "BD"))
        }.distinct()

        var lastReason = "No compatible progressive MP4 stream was returned"
        var lastStatus = ""
        for (attempt in attempts) {
            for (profile in profiles) {
                val response = runCatching {
                    requestPlayer(videoId, attempt.visitorData, attempt.region, profile)
                }.getOrElse { error ->
                    lastReason = error.message ?: lastReason
                    null
                } ?: continue

                val playability = response.optJSONObject("playabilityStatus")
                lastStatus = playability?.optString("status").orEmpty()
                if (lastStatus != "OK") {
                    lastReason = playability?.optString("reason")
                        ?.takeIf { it.isNotBlank() }
                        ?: playability?.optJSONArray("messages")?.optString(0)
                        ?: lastReason
                    continue
                }

                val formats = parseProgressiveFormats(response.optJSONObject("streamingData"), profile)
                if (formats.isEmpty()) continue
                val title = response.optJSONObject("videoDetails")?.optString("title")
                    ?.takeIf { it.isNotBlank() }
                    ?: "YouTube class video"
                return YoutubeDeviceResolver.Result(
                    videoId = videoId,
                    title = title,
                    formats = formats,
                    variants = formats.map { format ->
                        YoutubeDeviceResolver.Variant(
                            height = format.height,
                            qualityLabel = format.qualityLabel,
                            progressive = format,
                        )
                    },
                    hlsUrl = null,
                )
            }
        }

        val hint = when {
            lastStatus == "LOGIN_REQUIRED" || lastReason.contains("sign in", ignoreCase = true) ->
                "This YouTube video requires sign-in, age verification, or account access"
            lastReason.contains("private", ignoreCase = true) ->
                "Private YouTube videos require the owning account"
            lastReason.contains("member", ignoreCase = true) ->
                "Members-only YouTube videos require the entitled account"
            lastReason.contains("live", ignoreCase = true) || lastReason.contains("upcoming", ignoreCase = true) ->
                "Live or upcoming YouTube videos may not expose a downloadable MP4 yet"
            else -> "YouTube did not expose a compatible fallback MP4 for this video"
        }
        throw IllegalStateException("$hint. $lastReason")
    }

    private fun requestPlayer(
        videoId: String,
        visitorData: String?,
        region: String,
        profile: ClientProfile,
    ): JSONObject {
        val client = JSONObject()
            .put("clientName", profile.name)
            .put("clientVersion", profile.version)
            .put("hl", "en")
            .put("gl", region)
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
        val endpoint = "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&t=${randomToken(12)}&id=$videoId"
        val request = Request.Builder()
            .url(endpoint)
            .header("User-Agent", profile.userAgent)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("X-Goog-Api-Format-Version", "2")
            .apply {
                if (!visitorData.isNullOrBlank()) header("X-Goog-Visitor-Id", visitorData)
            }
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("YouTube fallback resolver HTTP ${response.code}")
            val text = readBodyLimited(response.body?.byteStream(), PLAYER_RESPONSE_LIMIT)
            if (text.isBlank()) error("YouTube fallback returned an empty player response")
            JSONObject(text)
        }
    }

    private fun parseProgressiveFormats(
        streamingData: JSONObject?,
        profile: ClientProfile,
    ): List<YoutubeDeviceResolver.Format> {
        val formats = streamingData?.optJSONArray("formats") ?: JSONArray()
        val byHeight = linkedMapOf<Int, YoutubeDeviceResolver.Format>()
        for (index in 0 until formats.length()) {
            val item = formats.optJSONObject(index) ?: continue
            val url = item.optString("url")
            if (!isAllowedGoogleVideoUrl(url)) continue
            val mime = item.optString("mimeType")
            if (!mime.startsWith("video/mp4", ignoreCase = true)) continue
            if (!mime.contains("avc1", ignoreCase = true) || !mime.contains("mp4a", ignoreCase = true)) continue
            val height = item.optInt("height", 0)
            if (height !in 1..MAX_FALLBACK_HEIGHT) continue
            var length = item.optString("contentLength").toLongOrNull() ?: 0L
            if (length <= 0L) length = runCatching { probeContentLength(url, profile.userAgent) }.getOrDefault(0L)
            if (length <= 0L) continue
            val bitrate = item.optLong("bitrate", 0L)
            val codecs = mime.substringAfter("codecs=", "").trim().trim('"')
            val candidate = YoutubeDeviceResolver.Format(
                itag = item.optInt("itag", -1),
                height = height,
                qualityLabel = item.optString("qualityLabel").ifBlank { "${height}p" },
                url = url,
                contentLength = length,
                mimeType = mime.substringBefore(';'),
                codecs = codecs,
                bitrate = bitrate,
                fps = item.optInt("fps", 0),
                hasVideo = true,
                hasAudio = true,
                clientName = profile.name,
                clientVersion = profile.version,
                clientId = "",
                userAgent = profile.userAgent,
                referer = YOUTUBE_REFERER,
            )
            val previous = byHeight[height]
            if (previous == null || candidate.bitrate > previous.bitrate) byHeight[height] = candidate
        }
        return byHeight.values.sortedBy { it.height }
    }

    private fun probeContentLength(url: String, userAgent: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", userAgent)
            .header("Referer", YOUTUBE_REFERER)
            .header("Accept-Encoding", "identity")
            .build()
        return http.newCall(request).execute().use { response ->
            response.header("Content-Range")
                ?.substringAfterLast('/', "")
                ?.toLongOrNull()
                ?: response.body?.contentLength()?.takeIf { response.code == 200 && it > 1L }
                ?: 0L
        }
    }

    private fun fetchVisitorData(videoId: String): String? {
        val request = Request.Builder()
            .url("https://www.youtube.com/watch?v=$videoId&hl=en")
            .header("User-Agent", WEB_USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val html = readBodyLimited(response.body?.byteStream(), WATCH_PAGE_LIMIT)
            VISITOR_PATTERNS.firstNotNullOfOrNull { pattern ->
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
                val count = stream.read(buffer, 0, minOf(buffer.size, maxBytes - total))
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

    private fun randomToken(length: Int): String = buildString(length) {
        repeat(length) { append(TOKEN_ALPHABET[RANDOM.nextInt(TOKEN_ALPHABET.length)]) }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val RANDOM = SecureRandom()
        private const val TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        private const val MAX_FALLBACK_HEIGHT = 720
        private const val WATCH_PAGE_LIMIT = 768 * 1024
        private const val PLAYER_RESPONSE_LIMIT = 2 * 1024 * 1024
        private const val YOUTUBE_REFERER = "https://www.youtube.com/"
        private const val WEB_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Mobile Safari/537.36"
        private val VISITOR_PATTERNS = listOf(
            Regex("\\\"VISITOR_DATA\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
            Regex("\\\"visitorData\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
        )
    }
}
