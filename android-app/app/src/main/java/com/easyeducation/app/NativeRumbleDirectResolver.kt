package com.easyeducation.app

import android.net.Uri
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Resolves public Rumble media directly on-device for native playback and secure downloads.
 * The production Easy Education endpoint remains a fallback, but an APK no longer depends on the
 * web deployment being on the exact same Rumble parser revision.
 */
internal class NativeRumbleDirectResolver(
    private val http: OkHttpClient = SHARED_HTTP,
) {
    data class Stream(
        val url: String,
        val height: Int,
        val hls: Boolean,
        val contentLength: Long = 0L,
        val bitrate: Long = 0L,
    )

    private data class Candidate(
        val kind: String,
        val url: String,
        val height: Int,
        val contentLength: Long,
        val bitrate: Long,
    )

    fun resolve(videoUrl: String, requestedHeight: Int): Stream {
        val streams = resolveAll(videoUrl)
        choose(streams.filter { it.hls }, requestedHeight)?.let { return it }
        choose(streams.filter { !it.hls }, requestedHeight)?.let { return it }
        error("Rumble did not expose a native HLS or MP4 stream")
    }

    fun resolveAll(videoUrl: String): List<Stream> {
        val parsed = validateVideoUrl(videoUrl)
        val embedId = resolveEmbedId(videoUrl, parsed)
        require(embedId.isNotBlank()) { "Rumble did not return a canonical video ID" }

        val metadataUrl = "https://rumble.com/embedJS/u3/?request=video&ver=2&v=${Uri.encode(embedId)}"
        val payload = JSONObject(
            requestText(
                url = metadataUrl,
                referer = videoUrl,
                accept = "application/json,*/*;q=0.8",
                origin = true,
            ),
        )
        require(payload.optInt("live", 0) != 2) { "Live Rumble streams are not supported yet" }

        val raw = mutableListOf<Candidate>()
        collectMediaEntries(payload.opt("ua"), raw)
        collectMediaEntries(payload.opt("u"), raw)

        val uniqueRaw = LinkedHashMap<String, Candidate>()
        raw.forEach { item ->
            if (!item.url.startsWith("https://", ignoreCase = true)) return@forEach
            val key = "${item.kind}:${item.url}"
            val previous = uniqueRaw[key]
            if (previous == null ||
                (previous.height <= 0 && item.height > 0) ||
                (previous.contentLength <= 0 && item.contentLength > 0)
            ) {
                uniqueRaw[key] = item
            }
        }

        val hls = uniqueRaw.values
            .filter { it.kind == KIND_HLS }
            .flatMap { candidate ->
                runCatching { expandHls(candidate, videoUrl) }
                    .getOrElse {
                        listOf(
                            Stream(
                                url = candidate.url,
                                height = candidate.height,
                                hls = true,
                                contentLength = candidate.contentLength,
                                bitrate = candidate.bitrate,
                            ),
                        )
                    }
            }

        val mp4 = uniqueRaw.values
            .filter { it.kind == KIND_MP4 }
            .map { candidate ->
                val length = candidate.contentLength.takeIf { it > 0L }
                    ?: runCatching { probeLength(candidate.url, videoUrl) }.getOrDefault(0L)
                Stream(
                    url = candidate.url,
                    height = candidate.height,
                    hls = false,
                    contentLength = length,
                    bitrate = candidate.bitrate,
                )
            }

        val unique = LinkedHashMap<String, Stream>()
        (hls + mp4).forEach { stream ->
            val key = "${if (stream.hls) "hls" else "mp4"}:${stream.height}:${stream.url}"
            val previous = unique[key]
            if (previous == null || (previous.contentLength <= 0 && stream.contentLength > 0)) {
                unique[key] = stream
            }
        }
        return unique.values.sortedWith(
            compareBy<Stream> { it.height.takeIf { height -> height > 0 } ?: Int.MAX_VALUE }
                .thenByDescending { it.hls },
        )
    }

    private fun validateVideoUrl(videoUrl: String): URI {
        val parsed = runCatching { URI(videoUrl.trim()) }.getOrNull()
            ?: error("Rumble video URL is invalid")
        val host = parsed.host?.lowercase().orEmpty()
        require(parsed.scheme.equals("https", ignoreCase = true) &&
            (host == "rumble.com" || host.endsWith(".rumble.com"))) {
            "Rumble video URL is invalid"
        }
        return parsed
    }

    private fun resolveEmbedId(videoUrl: String, parsed: URI): String {
        EMBED_PATH.find(parsed.path.orEmpty())?.groupValues?.getOrNull(1)
            ?.takeIf { it.isNotBlank() }
            ?.let { return it.lowercase() }

        val oEmbedUrl = "https://rumble.com/api/Media/oembed.json?url=${Uri.encode(videoUrl)}"
        runCatching {
            val payload = JSONObject(
                requestText(
                    url = oEmbedUrl,
                    referer = null,
                    accept = "application/json",
                    origin = false,
                ),
            )
            extractEmbedId(payload.optString("html"))
        }.getOrNull()?.takeIf { it.isNotBlank() }?.let { return it }

        val page = requestText(
            url = videoUrl,
            referer = null,
            accept = "text/html,application/xhtml+xml",
            origin = false,
        )
        return extractEmbedId(page)
    }

    private fun extractEmbedId(value: String): String {
        val normalized = value
            .replace("\\u002F", "/", ignoreCase = true)
            .replace("\\/", "/")
            .replace("&amp;", "&", ignoreCase = true)
        return EMBED_URL.find(normalized)?.groupValues?.getOrNull(1)?.lowercase().orEmpty()
    }

    private fun expandHls(candidate: Candidate, videoUrl: String): List<Stream> {
        val text = requestText(
            url = candidate.url,
            referer = videoUrl,
            accept = "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8",
            origin = true,
        )
        val lines = text.lines()
        val isMaster = lines.any { it.startsWith("#EXT-X-STREAM-INF:") }
        if (!isMaster) {
            return listOf(
                Stream(
                    url = candidate.url,
                    height = candidate.height,
                    hls = true,
                    contentLength = estimateMediaPlaylistSize(lines, candidate.url, candidate.bitrate),
                    bitrate = candidate.bitrate,
                ),
            )
        }

        val variants = mutableListOf<Stream>()
        lines.forEachIndexed { index, line ->
            if (!line.startsWith("#EXT-X-STREAM-INF:")) return@forEachIndexed
            val next = lines.drop(index + 1)
                .firstOrNull { it.isNotBlank() && !it.trimStart().startsWith("#") }
                ?: return@forEachIndexed
            val height = Regex("RESOLUTION=\\d+x(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()
                ?: candidate.height
            val bandwidth = Regex("(?:AVERAGE-)?BANDWIDTH=(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toLongOrNull()
                ?: candidate.bitrate
            val variantUrl = URI(candidate.url).resolve(next.trim()).toString()
            val size = runCatching {
                val mediaText = requestText(
                    url = variantUrl,
                    referer = videoUrl,
                    accept = "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8",
                    origin = true,
                )
                estimateMediaPlaylistSize(mediaText.lines(), variantUrl, bandwidth)
            }.getOrDefault(0L)
            variants += Stream(
                url = variantUrl,
                height = height,
                hls = true,
                contentLength = size,
                bitrate = bandwidth,
            )
        }
        return variants.ifEmpty {
            listOf(Stream(candidate.url, candidate.height, hls = true, candidate.contentLength, candidate.bitrate))
        }
    }

    private fun estimateMediaPlaylistSize(lines: List<String>, playlistUrl: String, bandwidth: Long): Long {
        val exact = lines.asSequence()
            .map { it.trim() }
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .mapNotNull { raw -> runCatching { URI(playlistUrl).resolve(raw).toString() }.getOrNull() }
            .sumOf { segmentUrl -> rangeLength(segmentUrl) }
        if (exact > 0L) return exact

        val seconds = lines.sumOf { line ->
            if (!line.startsWith("#EXTINF:")) 0.0
            else line.substringAfter(':').substringBefore(',').toDoubleOrNull() ?: 0.0
        }
        return if (seconds > 0.0 && bandwidth > 0L) {
            ((bandwidth.toDouble() / 8.0) * seconds).toLong().coerceAtLeast(0L)
        } else 0L
    }

    private fun rangeLength(url: String): Long = runCatching {
        val query = URI(url).rawQuery.orEmpty()
        val encodedRange = query.split('&')
            .firstOrNull { it.substringBefore('=') == "r_range" }
            ?.substringAfter('=', "")
            .orEmpty()
        val range = Uri.decode(encodedRange)
        val start = range.substringBefore('-').toLongOrNull() ?: return@runCatching 0L
        val end = range.substringAfter('-', "").toLongOrNull() ?: return@runCatching 0L
        if (end >= start) end - start + 1L else 0L
    }.getOrDefault(0L)

    private fun probeLength(url: String, videoUrl: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .headers(rumbleHeaders(videoUrl))
            .get()
            .build()
        return http.newCall(request).execute().use { response ->
            val range = response.header("Content-Range").orEmpty()
            val total = range.substringAfterLast('/', "").toLongOrNull()
            total ?: if (response.code == 200) response.header("Content-Length")?.toLongOrNull() ?: 0L else 0L
        }
    }

    private fun requestText(
        url: String,
        referer: String?,
        accept: String,
        origin: Boolean,
    ): String {
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", RUMBLE_USER_AGENT)
            .header("Accept", accept)
            .header("Accept-Language", "en-US,en;q=0.9")
        if (!referer.isNullOrBlank()) builder.header("Referer", referer)
        if (origin) builder.header("Origin", RUMBLE_ORIGIN)
        return http.newCall(builder.get().build()).execute().use { response ->
            if (!response.isSuccessful) error("Rumble metadata returned HTTP ${response.code}")
            response.body?.string()?.takeIf { it.isNotBlank() }
                ?: error("Rumble metadata response was empty")
        }
    }

    private fun collectMediaEntries(
        node: Any?,
        output: MutableList<Candidate>,
        keyHint: String = "",
        inheritedHeight: Int = 0,
    ) {
        when (node) {
            null, JSONObject.NULL -> return
            is String -> {
                if (!node.startsWith("http://", true) && !node.startsWith("https://", true)) return
                val kind = inferKind(node, keyHint, null)
                if (kind.isBlank()) return
                output += Candidate(
                    kind = kind,
                    url = node,
                    height = inferHeight(null, keyHint, node, inheritedHeight),
                    contentLength = 0L,
                    bitrate = 0L,
                )
            }
            is JSONArray -> {
                for (index in 0 until node.length()) {
                    collectMediaEntries(node.opt(index), output, keyHint, inheritedHeight)
                }
            }
            is JSONObject -> {
                val directUrl = node.optString("url").trim()
                val ownHeight = inferHeight(node, keyHint, directUrl, inheritedHeight)
                if (directUrl.startsWith("http://", true) || directUrl.startsWith("https://", true)) {
                    val kind = inferKind(directUrl, keyHint, node)
                    if (kind.isNotBlank()) {
                        output += Candidate(
                            kind = kind,
                            url = directUrl,
                            height = ownHeight,
                            contentLength = listOf(
                                node.optJSONObject("meta")?.optLong("size", 0L) ?: 0L,
                                node.optLong("size", 0L),
                                node.optLong("contentLength", 0L),
                            ).firstOrNull { it > 0L } ?: 0L,
                            bitrate = listOf(
                                node.optJSONObject("meta")?.optLong("bitrate", 0L) ?: 0L,
                                node.optLong("bitrate", 0L),
                            ).firstOrNull { it > 0L } ?: 0L,
                        )
                    }
                }

                val keys = node.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (key == "url") continue
                    collectMediaEntries(node.opt(key), output, key, ownHeight)
                }
            }
        }
    }

    private fun inferKind(url: String, keyHint: String, value: JSONObject?): String {
        val normalizedUrl = url.lowercase()
        val hint = keyHint.lowercase()
        val type = listOf(
            value?.optString("type").orEmpty(),
            value?.optString("mime").orEmpty(),
            value?.optString("mimeType").orEmpty(),
        ).joinToString(" ").lowercase()
        return when {
            normalizedUrl.contains(".m3u8") || hint.contains("hls") || type.contains("mpegurl") -> KIND_HLS
            normalizedUrl.contains(".mp4") || hint.contains("mp4") || type.contains("video/mp4") -> KIND_MP4
            else -> ""
        }
    }

    private fun inferHeight(
        value: JSONObject?,
        keyHint: String,
        url: String,
        fallback: Int,
    ): Int {
        val meta = value?.optJSONObject("meta")
        val candidates = listOf(
            meta?.opt("h"),
            meta?.opt("height"),
            value?.opt("h"),
            value?.opt("height"),
            value?.optString("resolution")?.substringAfter('x', ""),
            keyHint.takeIf { it.matches(Regex("\\d{3,4}")) },
            HEIGHT_HINT.find(keyHint)?.groupValues?.getOrNull(1),
            HEIGHT_IN_URL.find(url)?.groupValues?.getOrNull(1),
            fallback,
        )
        for (candidate in candidates) {
            val height = candidate?.toString()?.toIntOrNull() ?: continue
            if (height in 144..MAX_HEIGHT) return height
        }
        return 0
    }

    private fun choose(items: List<Stream>, requestedHeight: Int): Stream? {
        if (items.isEmpty()) return null
        val known = items.filter { it.height > 0 }
        return known.firstOrNull { it.height == requestedHeight }
            ?: known.filter { it.height <= requestedHeight }.maxByOrNull { it.height }
            ?: known.minByOrNull { it.height }
            ?: items.firstOrNull()
    }

    companion object {
        const val RUMBLE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"
        const val RUMBLE_ORIGIN = "https://rumble.com"

        fun rumbleHeaders(videoUrl: String): okhttp3.Headers = okhttp3.Headers.headersOf(
            "User-Agent", RUMBLE_USER_AGENT,
            "Referer", videoUrl,
            "Origin", RUMBLE_ORIGIN,
            "Accept-Encoding", "identity",
        )

        private const val KIND_HLS = "hls"
        private const val KIND_MP4 = "mp4"
        private const val MAX_HEIGHT = 2160
        private val EMBED_PATH = Regex("^/embed/(?:[0-9a-z]+\\.)?([0-9a-z]+)", RegexOption.IGNORE_CASE)
        private val EMBED_URL = Regex(
            "(?:https?:)?//(?:www\\.)?rumble\\.com/embed/(?:[0-9a-z]+\\.)?([0-9a-z]+)",
            RegexOption.IGNORE_CASE,
        )
        private val HEIGHT_HINT = Regex("(\\d{3,4})p", RegexOption.IGNORE_CASE)
        private val HEIGHT_IN_URL = Regex("(?:^|[-_/])(\\d{3,4})p(?:[-_.?/]|$)", RegexOption.IGNORE_CASE)
        private val SHARED_HTTP = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(45, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
