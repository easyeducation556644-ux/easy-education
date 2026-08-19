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
 * Device-side YouTube resolver used for native playback and secure offline copies.
 *
 * Important: Android/iOS YouTube clients now commonly return HTTPS/GVS URLs that need
 * a PO token. Those URLs look valid in the player response but return HTTP 403 when the
 * media is requested. Use the current JS-less VisionOS client first (the same default
 * strategy used by current yt-dlp), then TV/embed fallbacks, and validate the actual
 * media bytes before exposing a quality to the UI.
 */
class YoutubeDeviceResolver(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(36, TimeUnit.SECONDS)
        .followRedirects(true)
        .retryOnConnectionFailure(true)
        .build(),
) {
    data class Format(
        val itag: Int,
        val height: Int,
        val qualityLabel: String,
        val url: String,
        val contentLength: Long,
        val mimeType: String,
        val codecs: String,
        val bitrate: Long,
        val fps: Int,
        val hasVideo: Boolean,
        val hasAudio: Boolean,
        val clientName: String,
        val clientVersion: String,
        val clientId: String,
        val userAgent: String,
        val referer: String,
    ) {
        val container: String
            get() = if (mimeType.endsWith("/webm", ignoreCase = true)) "webm" else "mp4"
    }

    data class Variant(
        val height: Int,
        val qualityLabel: String,
        val progressive: Format? = null,
        val video: Format? = null,
        val audio: Format? = null,
    ) {
        val adaptive: Boolean get() = progressive == null && video != null && audio != null
        val transferBytes: Long
            get() = progressive?.contentLength?.takeIf { it > 0 }
                ?: if ((video?.contentLength ?: 0L) > 0L && (audio?.contentLength ?: 0L) > 0L) {
                    video!!.contentLength + audio!!.contentLength
                } else 0L
        val container: String get() = progressive?.container ?: video?.container ?: "mp4"
    }

    data class Result(
        val videoId: String,
        val title: String,
        val formats: List<Format>,
        val variants: List<Variant>,
    ) {
        val recommendedHeight: Int
            get() = variants.filter { it.height <= 480 }.maxOfOrNull { it.height }
                ?: variants.minOfOrNull { it.height }
                ?: 360
    }

    private data class ClientProfile(
        val name: String,
        val version: String,
        val clientId: String,
        val userAgent: String,
        val embeddedUrl: String? = null,
        val extra: JSONObject.() -> Unit = {},
    )

    fun resolve(videoUrl: String): Result {
        val videoId = extractVideoId(videoUrl)
            ?: throw IllegalArgumentException("Invalid YouTube video URL")
        val visitorData = runCatching { fetchVisitorData(videoId) }.getOrNull()

        val profiles = listOf(
            // Current yt-dlp uses VisionOS as its default JS-less YouTube client.
            ClientProfile(
                name = "VISIONOS",
                version = "1.02",
                clientId = "101",
                userAgent = VISIONOS_USER_AGENT,
            ) {
                put("deviceMake", "Apple")
                put("deviceModel", "RealityDevice17,1")
                put("osName", "visionOS")
                put("osVersion", "26.5.23O471")
            },
            ClientProfile(
                name = "TVHTML5",
                version = "7.20260707.07.00",
                clientId = "7",
                userAgent = TV_USER_AGENT,
            ),
            ClientProfile(
                name = "TVHTML5",
                version = "5.20260707",
                clientId = "7",
                userAgent = TV_DOWNGRADED_USER_AGENT,
            ),
            ClientProfile(
                name = "WEB_EMBEDDED_PLAYER",
                version = "2.20260708.00.00",
                clientId = "56",
                userAgent = WEB_USER_AGENT,
                embeddedUrl = "https://www.reddit.com/",
            ),
        )

        var lastReason = "No directly downloadable YouTube stream was returned"
        for (profile in profiles) {
            val response = runCatching { requestPlayer(videoId, visitorData, profile) }
                .getOrElse {
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
            val streams = parseStreams(response.optJSONObject("streamingData"), profile)
            if (streams.isEmpty()) {
                lastReason = "${profile.name} returned no direct media URLs"
                continue
            }

            val progressive = buildProgressive(streams)
            val candidateVariants = buildVariants(streams, progressive)
            val variants = validateVariants(candidateVariants)
            if (variants.isEmpty()) {
                lastReason = "${profile.name} media URLs were rejected by YouTube"
                continue
            }

            val validatedProgressive = variants.mapNotNull { it.progressive }
                .distinctBy { it.itag }
                .sortedBy { it.height }
            return Result(videoId, title, validatedProgressive, variants.sortedBy { it.height })
        }

        throw IllegalStateException(
            "$lastReason. YouTube did not expose a validated direct stream for this video.",
        )
    }

    /** Online playback prefers a validated single-file A/V stream. */
    fun pickFormat(videoUrl: String, requestedHeight: Int): Pair<Result, Format> {
        val result = resolve(videoUrl)
        val exact = result.formats.firstOrNull { it.height == requestedHeight }
        val below = result.formats.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
        val selected = exact ?: below ?: result.formats.minByOrNull { it.height }
            ?: throw IllegalStateException("No validated progressive YouTube stream is available")
        return result to selected
    }

    /** Offline download must honor the user's selected height exactly. */
    fun pickVariant(videoUrl: String, requestedHeight: Int): Pair<Result, Variant> {
        val result = resolve(videoUrl)
        val selected = result.variants.firstOrNull { it.height == requestedHeight }
            ?: throw IllegalStateException("${requestedHeight}p is no longer available. Choose a quality again.")
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
            .put("userAgent", profile.userAgent)
            .put("hl", "en")
            .put("gl", "US")
            .put("utcOffsetMinutes", 0)
        profile.extra(client)
        if (!visitorData.isNullOrBlank()) client.put("visitorData", visitorData)

        val context = JSONObject().put("client", client)
        profile.embeddedUrl?.let { embedUrl ->
            context.put("thirdParty", JSONObject().put("embedUrl", embedUrl))
        }

        val body = JSONObject()
            .put("context", context)
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
            .header("X-YouTube-Client-Name", profile.clientId)
            .header("X-YouTube-Client-Version", profile.version)
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
        if (!visitorData.isNullOrBlank()) {
            requestBuilder.header("X-Goog-Visitor-Id", visitorData)
        }

        http.newCall(requestBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) error("YouTube ${profile.name} resolver HTTP ${response.code}")
            val text = readBodyLimited(response.body?.byteStream(), PLAYER_RESPONSE_LIMIT)
            if (text.isBlank()) error("YouTube returned an empty player response")
            return JSONObject(text)
        }
    }

    private fun parseStreams(streamingData: JSONObject?, profile: ClientProfile): List<Format> {
        val raw = buildList {
            addAll(jsonObjects(streamingData?.optJSONArray("formats")))
            addAll(jsonObjects(streamingData?.optJSONArray("adaptiveFormats")))
        }
        val result = mutableListOf<Format>()
        val seen = hashSetOf<Int>()

        for (item in raw) {
            val itag = item.optInt("itag", -1)
            if (itag <= 0 || !seen.add(itag)) continue
            val url = item.optString("url")
            // Deliberately ignore signatureCipher/cipher URLs. Without current JS signature
            // transforms they are not safe to expose as downloadable qualities.
            if (!isAllowedGoogleVideoUrl(url)) continue

            val rawMime = item.optString("mimeType")
            val mimeType = rawMime.substringBefore(';').trim().lowercase()
            if (mimeType !in SUPPORTED_STREAM_MIMES) continue
            val codecs = Regex("codecs=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
                .find(rawMime)?.groupValues?.getOrNull(1).orEmpty()
            val codecList = codecs.split(',').map { it.trim().lowercase() }.filter { it.isNotBlank() }
            val isVideoMime = mimeType.startsWith("video/")
            val isAudioMime = mimeType.startsWith("audio/")
            val hasVideo = isVideoMime
            val hasAudioCodec = codecList.any { codec ->
                codec.startsWith("mp4a") || codec.startsWith("opus") || codec.startsWith("vorbis")
            }
            val hasAudio = isAudioMime || (isVideoMime && hasAudioCodec)
            val height = item.optInt("height", 0)
            if (hasVideo && (height <= 0 || height > MAX_ADAPTIVE_HEIGHT)) continue

            val reportedLength = item.optString("contentLength").toLongOrNull() ?: 0L
            var format = Format(
                itag = itag,
                height = height,
                qualityLabel = item.optString("qualityLabel").ifBlank {
                    if (height > 0) "${height}p" else item.optString("audioQuality", "Audio")
                },
                url = url,
                contentLength = reportedLength,
                mimeType = mimeType,
                codecs = codecs,
                bitrate = item.optLong("bitrate", 0L),
                fps = item.optInt("fps", 0),
                hasVideo = hasVideo,
                hasAudio = hasAudio,
                clientName = profile.name,
                clientVersion = profile.version,
                clientId = profile.clientId,
                userAgent = profile.userAgent,
                referer = profile.embeddedUrl ?: "https://www.youtube.com/",
            )
            if (format.contentLength <= 0L) {
                val length = runCatching { probeContentLength(format) }.getOrDefault(0L)
                if (length <= 0L) continue
                format = format.copy(contentLength = length)
            }
            result += format
        }
        return result
    }

    private fun buildProgressive(streams: List<Format>): List<Format> = streams
        .filter { it.hasVideo && it.hasAudio && it.height in 1..MAX_ADAPTIVE_HEIGHT }
        .groupBy { it.height }
        .mapNotNull { (_, choices) -> chooseProgressive(choices) }
        .sortedBy { it.height }

    private fun buildVariants(streams: List<Format>, progressive: List<Format>): List<Variant> {
        val progressiveByHeight = progressive.associateBy { it.height }
        val videoOnly = streams.filter { it.hasVideo && !it.hasAudio && it.height in 1..MAX_ADAPTIVE_HEIGHT }
        val audioOnly = streams.filter { !it.hasVideo && it.hasAudio }
        val heights = (progressiveByHeight.keys + videoOnly.map { it.height }).distinct().sorted()

        return heights.mapNotNull { height ->
            progressiveByHeight[height]?.let { format ->
                return@mapNotNull Variant(
                    height = height,
                    qualityLabel = format.qualityLabel.ifBlank { "${height}p" },
                    progressive = format,
                )
            }
            val video = chooseAdaptiveVideo(height, videoOnly.filter { it.height == height })
                ?: return@mapNotNull null
            val audio = chooseAudioFor(video, audioOnly) ?: return@mapNotNull null
            Variant(
                height = height,
                qualityLabel = video.qualityLabel.ifBlank { "${height}p" },
                video = video,
                audio = audio,
            )
        }
    }

    private fun validateVariants(candidates: List<Variant>): List<Variant> {
        val cache = mutableMapOf<String, Boolean>()
        fun valid(format: Format): Boolean = cache.getOrPut("${format.clientName}:${format.itag}:${format.url}") {
            validateFormat(format)
        }
        return candidates.filter { variant ->
            val progressive = variant.progressive
            if (progressive != null) {
                valid(progressive)
            } else {
                val video = variant.video
                val audio = variant.audio
                video != null && audio != null && valid(video) && valid(audio)
            }
        }
    }

    private fun validateFormat(format: Format): Boolean {
        if (format.contentLength <= 0L) return false
        val end = minOf(format.contentLength - 1L, VALIDATION_BYTES - 1L)
        if (end < 0L) return false
        return runCatching {
            http.newCall(streamRequest(format, 0L, end)).execute().use { response ->
                if (response.code != 206) return@use false
                val range = response.header("Content-Range").orEmpty()
                val total = range.substringAfterLast('/', "").toLongOrNull()
                range.startsWith("bytes 0-$end/") && (total == null || total == format.contentLength)
            }
        }.getOrDefault(false)
    }

    private fun probeContentLength(format: Format): Long =
        http.newCall(streamRequest(format, 0L, 0L)).execute().use { response ->
            if (response.code != 206) return@use 0L
            response.header("Content-Range").orEmpty().substringAfterLast('/', "").toLongOrNull() ?: 0L
        }

    private fun streamRequest(format: Format, start: Long, end: Long): Request = Request.Builder()
        .url(format.url)
        .header("Range", "bytes=$start-$end")
        .header("User-Agent", format.userAgent)
        .header("Accept-Encoding", "identity")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("X-YouTube-Client-Name", format.clientId)
        .header("X-YouTube-Client-Version", format.clientVersion)
        .header("Referer", format.referer)
        .get()
        .build()

    private fun chooseProgressive(choices: List<Format>): Format? {
        val mp4 = choices.filter { it.mimeType == "video/mp4" }
        return (mp4.ifEmpty { choices }).maxByOrNull { it.bitrate }
    }

    private fun chooseAdaptiveVideo(height: Int, choices: List<Format>): Format? {
        if (choices.isEmpty()) return null
        val preferredContainer = if (height <= 1080) "mp4" else "webm"
        val preferred = choices.filter { it.container == preferredContainer }
        return (preferred.ifEmpty { choices }).maxWithOrNull(
            compareBy<Format> { it.fps }.thenBy { it.bitrate },
        )
    }

    private fun chooseAudioFor(video: Format, choices: List<Format>): Format? {
        val sameContainer = choices.filter { it.container == video.container }
        return sameContainer.maxByOrNull { it.bitrate }
    }

    private fun jsonObjects(array: JSONArray?): List<JSONObject> = buildList {
        if (array == null) return@buildList
        for (index in 0 until array.length()) array.optJSONObject(index)?.let(::add)
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
        private const val MAX_ADAPTIVE_HEIGHT = 2160
        private const val VALIDATION_BYTES = 1024L
        private const val WATCH_PAGE_LIMIT = 768 * 1024
        private const val PLAYER_RESPONSE_LIMIT = 2 * 1024 * 1024
        const val VISIONOS_USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        private const val TV_USER_AGENT =
            "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)"
        private const val TV_DOWNGRADED_USER_AGENT =
            "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version"
        private const val WEB_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Mobile Safari/537.36"
        const val DOWNLOAD_USER_AGENT = VISIONOS_USER_AGENT
        private val SUPPORTED_STREAM_MIMES = setOf(
            "video/mp4",
            "audio/mp4",
            "video/webm",
            "audio/webm",
        )

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
