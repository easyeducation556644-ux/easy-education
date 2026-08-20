package com.easyeducation.app

import android.net.Uri
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Resolves a public Rumble watch URL directly on-device for native Media3 playback.
 *
 * Playback must not depend on the web deployment being on the same revision as the APK. Rumble's
 * public oEmbed + embedJS metadata is enough to discover a native HLS/MP4 stream. The existing
 * authenticated Easy Education service remains available as a fallback in
 * [NativePlaybackSourceResolver] and is still used by the secure download path.
 */
internal class NativeRumbleDirectResolver(
    private val http: OkHttpClient = SHARED_HTTP,
) {
    data class Stream(
        val url: String,
        val height: Int,
        val hls: Boolean,
    )

    private data class Candidate(
        val kind: String,
        val url: String,
        val height: Int,
    )

    fun resolve(videoUrl: String, requestedHeight: Int): Stream {
        val parsed = runCatching { URI(videoUrl.trim()) }.getOrNull()
            ?: error("Rumble video URL is invalid")
        val host = parsed.host?.lowercase().orEmpty()
        require(parsed.scheme.equals("https", ignoreCase = true) &&
            (host == "rumble.com" || host.endsWith(".rumble.com"))) {
            "Rumble video URL is invalid"
        }

        val embedId = resolveEmbedId(videoUrl, parsed)
        require(embedId.isNotBlank()) { "Rumble did not return a canonical video ID" }

        val metadataUrl = "https://rumble.com/embedJS/u3/?request=video&ver=2&v=${Uri.encode(embedId)}"
        val payload = JSONObject(
            requestText(
                url = metadataUrl,
                referer = videoUrl,
                accept = "application/json,*/*;q=0.8",
            ),
        )
        require(payload.optInt("live", 0) != 2) { "Live Rumble streams are not supported yet" }

        val candidates = mutableListOf<Candidate>()
        collectMediaEntries(payload.opt("ua"), candidates)
        collectMediaEntries(payload.opt("u"), candidates)

        val unique = LinkedHashMap<String, Candidate>()
        candidates.forEach { item ->
            if (!item.url.startsWith("https://", ignoreCase = true)) return@forEach
            val key = "${item.kind}:${item.url}"
            val previous = unique[key]
            if (previous == null || (previous.height <= 0 && item.height > 0)) unique[key] = item
        }

        // Rumble HLS is the most tolerant path across modern uploads (including HLS-only videos).
        // Media3 receives the same Referer/User-Agent on playlists and segment requests.
        choose(unique.values.filter { it.kind == KIND_HLS }, requestedHeight)?.let { selected ->
            return Stream(selected.url, selected.height.takeIf { it > 0 } ?: requestedHeight, hls = true)
        }
        choose(unique.values.filter { it.kind == KIND_MP4 }, requestedHeight)?.let { selected ->
            return Stream(selected.url, selected.height.takeIf { it > 0 } ?: requestedHeight, hls = false)
        }
        error("Rumble did not expose a native HLS or MP4 stream")
    }

    private fun resolveEmbedId(videoUrl: String, parsed: URI): String {
        EMBED_PATH.find(parsed.path.orEmpty())?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }
            ?.let { return it.lowercase() }

        val oEmbedUrl = "https://rumble.com/api/Media/oembed.json?url=${Uri.encode(videoUrl)}"
        runCatching {
            val payload = JSONObject(
                requestText(
                    url = oEmbedUrl,
                    referer = null,
                    accept = "application/json",
                ),
            )
            extractEmbedId(payload.optString("html"))
        }.getOrNull()?.takeIf { it.isNotBlank() }?.let { return it }

        val page = requestText(
            url = videoUrl,
            referer = null,
            accept = "text/html,application/xhtml+xml",
        )
        return extractEmbedId(page)
    }

    private fun extractEmbedId(value: String): String {
        val normalized = value
            .replace("\\u002F", "/", ignoreCase = true)
            .replace("\\/", "/")
        return EMBED_URL.find(normalized)?.groupValues?.getOrNull(1)?.lowercase().orEmpty()
    }

    private fun requestText(url: String, referer: String?, accept: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", RUMBLE_USER_AGENT)
            .header("Accept", accept)
            .header("Accept-Language", "en-US,en;q=0.9")
            .apply { if (!referer.isNullOrBlank()) header("Referer", referer) }
            .get()
            .build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                error("Rumble metadata returned HTTP ${response.code}")
            }
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
                    if (kind.isNotBlank()) output += Candidate(kind, directUrl, ownHeight)
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
            normalizedUrl.contains(".m3u8") || hint.contains("hls") ||
                type.contains("mpegurl") -> KIND_HLS
            normalizedUrl.contains(".mp4") || hint.contains("mp4") ||
                type.contains("video/mp4") -> KIND_MP4
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

    private fun choose(items: List<Candidate>, requestedHeight: Int): Candidate? {
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
            .retryOnConnectionFailure(true)
            .build()
    }
}
