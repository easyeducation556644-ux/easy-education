package com.easyeducation.app

import android.content.Context
import android.net.Uri
import com.google.firebase.FirebaseApp
import okhttp3.OkHttpClient
import okhttp3.Request
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.VideoStream
import java.util.concurrent.TimeUnit

/**
 * Compatibility wrapper around the mature YouTube extraction engine.
 *
 * The rest of Easy Education still consumes Result/Variant/Format, but the URLs now come from an
 * extractor that handles YouTube player JS, signatureCipher and n-parameter deobfuscation instead
 * of our previous hand-written client-profile guesses.
 */
class YoutubeDeviceResolver(
    private val context: Context = FirebaseApp.getInstance().applicationContext,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(22, TimeUnit.SECONDS)
        .callTimeout(32, TimeUnit.SECONDS)
        .followRedirects(true)
        .retryOnConnectionFailure(true)
        .build(),
) {
    /** Backward-compatible constructor for the download workers that already own an OkHttpClient. */
    constructor(http: OkHttpClient) : this(
        context = FirebaseApp.getInstance().applicationContext,
        http = http,
    )

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
        val clientName: String = "",
        val clientVersion: String = "",
        val clientId: String = "",
        val userAgent: String = DOWNLOAD_USER_AGENT,
        val referer: String = YOUTUBE_REFERER,
    ) {
        val container: String
            get() = if (mimeType.contains("webm", ignoreCase = true)) "webm" else "mp4"
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
            get() = progressive?.contentLength?.takeIf { it > 0L }
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
        val hlsUrl: String? = null,
    ) {
        val recommendedHeight: Int
            get() = variants.filter { it.height <= 480 }.maxOfOrNull { it.height }
                ?: variants.minOfOrNull { it.height }
                ?: 360
    }

    fun resolve(videoUrl: String): Result {
        val videoId = extractVideoId(videoUrl)
            ?: throw IllegalArgumentException("Invalid YouTube video URL")
        val info = YoutubeExtractorEngine.resolve(context, canonicalWatchUrl(videoId))

        val progressive = info.videoStreams
            .asSequence()
            .filter { it.isUrl && it.content.startsWith("https://") }
            .mapNotNull { toProgressiveFormat(it) }
            .filter { it.height in 1..MAX_HEIGHT }
            .groupBy { it.height }
            .mapNotNull { (_, values) -> chooseProgressive(values) }
            .sortedBy { it.height }

        val videoOnly = info.videoOnlyStreams
            .asSequence()
            .filter { it.isUrl && it.content.startsWith("https://") }
            .mapNotNull { toVideoOnlyFormat(it) }
            .filter { it.height in 1..MAX_HEIGHT }
            .toList()

        val audioOnly = info.audioStreams
            .asSequence()
            .filter { it.isUrl && it.content.startsWith("https://") }
            .mapNotNull { toAudioFormat(it) }
            .toList()

        val variants = buildVariants(progressive, videoOnly, audioOnly)
        if (variants.isEmpty()) {
            throw IllegalStateException("YouTube did not expose downloadable qualities for this video")
        }

        return Result(
            videoId = videoId,
            title = info.name.ifBlank { "YouTube class video" },
            formats = progressive,
            variants = variants,
            hlsUrl = info.hlsUrl?.takeIf { it.startsWith("https://") },
        )
    }

    fun pickFormat(videoUrl: String, requestedHeight: Int): Pair<Result, Format> {
        val result = resolve(videoUrl)
        val selected = result.formats.firstOrNull { it.height == requestedHeight }
            ?: result.formats.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
            ?: result.formats.minByOrNull { it.height }
            ?: throw IllegalStateException("No single-file YouTube stream is available for online playback")
        return result to selected
    }

    fun pickVariant(videoUrl: String, requestedHeight: Int): Pair<Result, Variant> {
        val result = resolve(videoUrl)
        val selected = result.variants.firstOrNull { it.height == requestedHeight }
            ?: throw IllegalStateException("${requestedHeight}p is no longer available. Choose a quality again.")
        return result to selected
    }

    private fun toProgressiveFormat(stream: VideoStream): Format? {
        val height = stream.height.takeIf { it > 0 } ?: parseHeight(stream.resolution)
        if (height <= 0) return null
        return Format(
            itag = stream.itag.takeIf { it > 0 } ?: stream.id.toIntOrNull() ?: -1,
            height = height,
            qualityLabel = stream.resolution.takeIf { it.isNotBlank() } ?: "${height}p",
            url = stream.content,
            contentLength = contentLength(stream.itagItem?.contentLength ?: 0L, stream.content),
            mimeType = stream.format?.mimeType ?: guessVideoMime(stream.content, stream.codec),
            codecs = stream.codec.orEmpty(),
            bitrate = stream.bitrate.toLong().coerceAtLeast(0L),
            fps = stream.fps.coerceAtLeast(0),
            hasVideo = true,
            hasAudio = true,
            userAgent = userAgentFor(stream.content),
        )
    }

    private fun toVideoOnlyFormat(stream: VideoStream): Format? {
        val height = stream.height.takeIf { it > 0 } ?: parseHeight(stream.resolution)
        if (height <= 0) return null
        return Format(
            itag = stream.itag.takeIf { it > 0 } ?: stream.id.toIntOrNull() ?: -1,
            height = height,
            qualityLabel = stream.resolution.takeIf { it.isNotBlank() } ?: "${height}p",
            url = stream.content,
            contentLength = contentLength(stream.itagItem?.contentLength ?: 0L, stream.content),
            mimeType = stream.format?.mimeType ?: guessVideoMime(stream.content, stream.codec),
            codecs = stream.codec.orEmpty(),
            bitrate = stream.bitrate.toLong().coerceAtLeast(0L),
            fps = stream.fps.coerceAtLeast(0),
            hasVideo = true,
            hasAudio = false,
            userAgent = userAgentFor(stream.content),
        )
    }

    private fun toAudioFormat(stream: AudioStream): Format? {
        val length = contentLength(stream.itagItem?.contentLength ?: 0L, stream.content)
        if (length <= 0L) return null
        return Format(
            itag = stream.itag.takeIf { it > 0 } ?: stream.id.toIntOrNull() ?: -1,
            height = 0,
            qualityLabel = stream.quality?.takeIf { it.isNotBlank() } ?: "Audio",
            url = stream.content,
            contentLength = length,
            mimeType = stream.format?.mimeType ?: guessAudioMime(stream.content, stream.codec),
            codecs = stream.codec.orEmpty(),
            bitrate = stream.bitrate.toLong().coerceAtLeast(0L),
            fps = 0,
            hasVideo = false,
            hasAudio = true,
            userAgent = userAgentFor(stream.content),
        )
    }

    private fun buildVariants(
        progressive: List<Format>,
        videoOnly: List<Format>,
        audioOnly: List<Format>,
    ): List<Variant> {
        val progressiveByHeight = progressive.associateBy { it.height }
        val heights = (progressiveByHeight.keys + videoOnly.map { it.height }).distinct().sorted()

        return heights.mapNotNull { height ->
            progressiveByHeight[height]?.takeIf { it.contentLength > 0L }?.let { format ->
                return@mapNotNull Variant(
                    height = height,
                    qualityLabel = format.qualityLabel,
                    progressive = format,
                )
            }

            val video = chooseAdaptiveVideo(height, videoOnly.filter { it.height == height })
                ?: return@mapNotNull null
            val audio = chooseAudioFor(video, audioOnly) ?: return@mapNotNull null
            if (video.contentLength <= 0L || audio.contentLength <= 0L) return@mapNotNull null
            Variant(
                height = height,
                qualityLabel = video.qualityLabel.ifBlank { "${height}p" },
                video = video,
                audio = audio,
            )
        }
    }

    private fun chooseProgressive(values: List<Format>): Format? {
        val mp4 = values.filter { it.container == "mp4" }
        return (mp4.ifEmpty { values }).maxByOrNull { it.bitrate }
    }

    private fun chooseAdaptiveVideo(height: Int, values: List<Format>): Format? {
        if (values.isEmpty()) return null
        val desired = if (height <= 1080) "mp4" else "webm"
        val preferred = values.filter { it.container == desired }
        return (preferred.ifEmpty { values }).maxWithOrNull(
            compareBy<Format> { it.fps }.thenBy { it.bitrate },
        )
    }

    private fun chooseAudioFor(video: Format, values: List<Format>): Format? {
        val sameContainer = values.filter { it.container == video.container }
        return sameContainer.maxByOrNull { it.bitrate }
    }

    private fun contentLength(reported: Long, url: String): Long {
        if (reported > 0L) return reported
        return runCatching { probeContentLength(url) }.getOrDefault(0L)
    }

    private fun probeContentLength(url: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", userAgentFor(url))
            .header("Referer", YOUTUBE_REFERER)
            .header("Accept-Encoding", "identity")
            .get()
            .build()
        return http.newCall(request).execute().use { response ->
            val total = response.header("Content-Range")
                ?.substringAfterLast('/', "")
                ?.toLongOrNull()
            total ?: response.body?.contentLength()?.takeIf { response.code == 200 && it > 1L } ?: 0L
        }
    }

    private fun userAgentFor(url: String): String {
        val client = runCatching { Uri.parse(url).getQueryParameter("c")?.uppercase() }.getOrNull()
        return when (client) {
            "VISIONOS" -> VISIONOS_USER_AGENT
            "IOS" -> IOS_USER_AGENT
            "ANDROID" -> ANDROID_USER_AGENT
            else -> DOWNLOAD_USER_AGENT
        }
    }

    private fun parseHeight(value: String?): Int = value.orEmpty()
        .let { Regex("(\\d{3,4})p", RegexOption.IGNORE_CASE).find(it)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0 }

    private fun guessVideoMime(url: String, codec: String?): String = when {
        url.contains("webm", ignoreCase = true) || codec.orEmpty().contains("vp", ignoreCase = true) ||
            codec.orEmpty().contains("av01", ignoreCase = true) -> "video/webm"
        else -> "video/mp4"
    }

    private fun guessAudioMime(url: String, codec: String?): String = when {
        url.contains("webm", ignoreCase = true) || codec.orEmpty().contains("opus", ignoreCase = true) -> "audio/webm"
        else -> "audio/mp4"
    }

    companion object {
        private const val MAX_HEIGHT = 2160
        private const val YOUTUBE_REFERER = "https://www.youtube.com/"
        const val DOWNLOAD_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0"
        private const val VISIONOS_USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        private const val IOS_USER_AGENT =
            "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
        private const val ANDROID_USER_AGENT =
            "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip"
        private val VIDEO_ID = Regex("^[A-Za-z0-9_-]{6,20}$")

        fun extractVideoId(value: String): String? = runCatching {
            val uri = Uri.parse(value.trim())
            val host = uri.host?.lowercase().orEmpty().removePrefix("www.").removePrefix("m.")
            val candidate = when {
                host == "youtu.be" -> uri.pathSegments.firstOrNull()
                host == "youtube.com" || host.endsWith(".youtube.com") -> {
                    uri.getQueryParameter("v")
                        ?: uri.pathSegments.let { parts ->
                            if (parts.firstOrNull() in setOf("shorts", "embed", "live")) parts.getOrNull(1) else null
                        }
                }
                else -> null
            }?.trim()
            candidate?.takeIf { VIDEO_ID.matches(it) }
        }.getOrNull()

        fun isYoutubeUrl(value: String): Boolean = extractVideoId(value) != null

        fun canonicalWatchUrl(videoId: String): String = "https://www.youtube.com/watch?v=$videoId"
    }
}
