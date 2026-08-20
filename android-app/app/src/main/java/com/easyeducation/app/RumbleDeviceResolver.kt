package com.easyeducation.app

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Resolves Rumble playback on the device instead of proxying playback through Vercel.
 *
 * Rumble CDN URLs are temporary and may be protected by request-context checks. We resolve fresh
 * embed metadata, keep the embed session cookies, prefer progressive MP4 for the native Media3
 * player, and probe candidate URLs from the actual device with the same browser-like request
 * context that playback will use.
 */
class RumbleDeviceResolver {
    private val cookieJar = RumbleCookieJar()
    private val http = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(22, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    data class Resolved(
        val url: String,
        val hls: Boolean,
        val requestHeaders: Map<String, String>,
        val height: Int,
    )

    private data class Candidate(
        val url: String,
        val hls: Boolean,
        val height: Int,
        val priority: Int,
    )

    fun resolve(sourceUrl: String, requestedHeight: Int): Resolved {
        require(isRumbleUrl(sourceUrl)) { "Invalid Rumble URL" }
        val embedId = resolveEmbedId(sourceUrl)
        require(embedId.isNotBlank()) { "Unable to find the Rumble video ID" }

        val embedUrl = "https://rumble.com/embed/$embedId/"
        seedEmbedSession(embedUrl)
        val payload = fetchMetadata(embedId, embedUrl)
        val candidates = collectCandidates(payload)
        require(candidates.isNotEmpty()) { "Rumble did not expose a playable CDN stream" }

        val ordered = candidates
            .distinctBy { "${it.hls}:${it.url}" }
            .sortedWith(
                compareBy<Candidate> { if (it.hls) 1 else 0 }
                    .thenBy { it.priority }
                    .thenBy { heightDistance(it.height, requestedHeight) }
                    .thenByDescending { it.height },
            )

        val headerVariants = listOf(
            rumbleHeaders(embedUrl, includeOrigin = true),
            rumbleHeaders(embedUrl, includeOrigin = false),
            rumbleHeaders(sourceUrl, includeOrigin = true),
            rumbleHeaders(sourceUrl, includeOrigin = false),
        )

        // Keep probing bounded: explicit MP4/HLS entries are first; recursive fallbacks follow.
        for (candidate in ordered.take(MAX_PROBED_CANDIDATES)) {
            for (headers in headerVariants) {
                if (probe(candidate, headers)) {
                    val playbackHeaders = headers.toMutableMap()
                    cookieJar.cookieHeader(candidate.url)
                        .takeIf { it.isNotBlank() }
                        ?.let { playbackHeaders["Cookie"] = it }
                    return Resolved(
                        url = candidate.url,
                        hls = candidate.hls,
                        requestHeaders = playbackHeaders,
                        height = candidate.height,
                    )
                }
            }
        }

        error("Rumble CDN rejected all playable stream candidates")
    }

    private fun resolveEmbedId(sourceUrl: String): String {
        val parsed = runCatching { URI(sourceUrl) }.getOrNull()
        val path = parsed?.path.orEmpty()
        val directEmbed = Regex("/embed/(?:[0-9a-z]+\\.)?([0-9a-z]+)", RegexOption.IGNORE_CASE)
            .find(path)?.groupValues?.getOrNull(1)
        if (!directEmbed.isNullOrBlank()) return directEmbed.lowercase()

        val watchId = path.split('/')
            .firstNotNullOfOrNull { segment ->
                Regex("^(v[0-9a-z]+)", RegexOption.IGNORE_CASE)
                    .find(segment)?.groupValues?.getOrNull(1)
            }
        if (!watchId.isNullOrBlank()) return watchId.lowercase()

        val oEmbedUrl = "https://rumble.com/api/Media/oembed.json?url=${java.net.URLEncoder.encode(sourceUrl, Charsets.UTF_8.name())}"
        return runCatching {
            http.newCall(
                Request.Builder()
                    .url(oEmbedUrl)
                    .header("User-Agent", DESKTOP_USER_AGENT)
                    .header("Accept", "application/json")
                    .get()
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) return@use ""
                val body = response.body?.string().orEmpty()
                val html = JSONObject(body).optString("html")
                Regex("rumble\\.com/embed/(?:[0-9a-z]+\\.)?([0-9a-z]+)", RegexOption.IGNORE_CASE)
                    .find(html)?.groupValues?.getOrNull(1)?.lowercase().orEmpty()
            }
        }.getOrDefault("")
    }

    private fun seedEmbedSession(embedUrl: String) {
        runCatching {
            http.newCall(
                Request.Builder()
                    .url(embedUrl)
                    .header("User-Agent", DESKTOP_USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Sec-Fetch-Dest", "iframe")
                    .header("Sec-Fetch-Mode", "navigate")
                    .header("Sec-Fetch-Site", "same-origin")
                    .get()
                    .build(),
            ).execute().use { response ->
                // Reading a small prefix is unnecessary; headers are enough for CookieJar to persist
                // Set-Cookie values and closing the body prevents the full embed page from buffering.
                response.body?.close()
            }
        }
    }

    private fun fetchMetadata(embedId: String, embedUrl: String): JSONObject {
        val endpoint = "https://rumble.com/embedJS/u3/?request=video&ver=2&v=$embedId"
        return http.newCall(
            Request.Builder()
                .url(endpoint)
                .header("User-Agent", DESKTOP_USER_AGENT)
                .header("Accept", "application/json,text/plain,*/*")
                .header("Referer", embedUrl)
                .header("Sec-Fetch-Dest", "empty")
                .header("Sec-Fetch-Mode", "cors")
                .header("Sec-Fetch-Site", "same-origin")
                .get()
                .build(),
        ).execute().use { response ->
            if (!response.isSuccessful) error("Rumble metadata returned HTTP ${response.code}")
            val body = response.body?.string().orEmpty()
            require(body.isNotBlank()) { "Rumble metadata response was empty" }
            JSONObject(body)
        }
    }

    private fun collectCandidates(payload: JSONObject): List<Candidate> {
        val output = mutableListOf<Candidate>()
        val fallbackHeight = inferHeight(payload, "", 360)

        // Prefer the canonical ua/u media groups used by Rumble's embed runtime.
        listOf(payload.optJSONObject("ua"), payload.optJSONObject("u")).forEach { root ->
            if (root == null) return@forEach
            collectExplicitGroup(root.opt("mp4"), hls = false, fallbackHeight, output)
            collectExplicitGroup(root.opt("hls"), hls = true, fallbackHeight, output)
        }

        val hasExplicitMp4 = output.any { !it.hls }
        val hasExplicitHls = output.any { it.hls }
        if (!hasExplicitMp4 || !hasExplicitHls) {
            listOf(payload.opt("ua"), payload.opt("u")).forEach { node ->
                collectRecursive(
                    node = node,
                    keyHint = "",
                    fallbackHeight = fallbackHeight,
                    output = output,
                    allowMp4 = !hasExplicitMp4,
                    allowHls = !hasExplicitHls,
                    depth = 0,
                )
            }
        }
        return output
    }

    private fun collectExplicitGroup(
        node: Any?,
        hls: Boolean,
        fallbackHeight: Int,
        output: MutableList<Candidate>,
    ) {
        when (node) {
            is JSONObject -> {
                val directUrl = node.optString("url")
                if (directUrl.startsWith("http", ignoreCase = true)) {
                    output += Candidate(
                        url = directUrl,
                        hls = hls || looksLikeHls(directUrl),
                        height = inferHeight(node, "", fallbackHeight),
                        priority = 0,
                    )
                }
                node.keys().forEach { key ->
                    if (key != "url") {
                        collectExplicitEntry(node.opt(key), key, hls, fallbackHeight, output)
                    }
                }
            }
            is JSONArray -> for (index in 0 until node.length()) {
                collectExplicitEntry(node.opt(index), index.toString(), hls, fallbackHeight, output)
            }
            is String -> if (node.startsWith("http", ignoreCase = true)) {
                output += Candidate(node, hls || looksLikeHls(node), fallbackHeight, 0)
            }
        }
    }

    private fun collectExplicitEntry(
        node: Any?,
        keyHint: String,
        hls: Boolean,
        fallbackHeight: Int,
        output: MutableList<Candidate>,
    ) {
        when (node) {
            is JSONObject -> {
                val url = node.optString("url")
                if (url.startsWith("http", ignoreCase = true)) {
                    output += Candidate(
                        url = url,
                        hls = hls || looksLikeHls(url),
                        height = inferHeight(node, keyHint, fallbackHeight),
                        priority = 0,
                    )
                } else {
                    collectExplicitGroup(node, hls, inferHeight(node, keyHint, fallbackHeight), output)
                }
            }
            is JSONArray -> for (index in 0 until node.length()) {
                collectExplicitEntry(node.opt(index), keyHint, hls, fallbackHeight, output)
            }
            is String -> if (node.startsWith("http", ignoreCase = true)) {
                output += Candidate(node, hls || looksLikeHls(node), keyHeight(keyHint) ?: fallbackHeight, 0)
            }
        }
    }

    private fun collectRecursive(
        node: Any?,
        keyHint: String,
        fallbackHeight: Int,
        output: MutableList<Candidate>,
        allowMp4: Boolean,
        allowHls: Boolean,
        depth: Int,
    ) {
        if (node == null || depth > 7) return
        when (node) {
            is String -> {
                if (!node.startsWith("http", ignoreCase = true)) return
                val isHls = looksLikeHls(node) || keyHint.contains("hls", true)
                val isMp4 = looksLikeMp4(node) || keyHint.contains("mp4", true)
                if ((isHls && allowHls) || (isMp4 && allowMp4)) {
                    output += Candidate(
                        url = node,
                        hls = isHls,
                        height = keyHeight(keyHint) ?: fallbackHeight,
                        priority = 1,
                    )
                }
            }
            is JSONArray -> for (index in 0 until node.length()) {
                collectRecursive(node.opt(index), keyHint, fallbackHeight, output, allowMp4, allowHls, depth + 1)
            }
            is JSONObject -> {
                val nextFallback = inferHeight(node, keyHint, fallbackHeight)
                val directUrl = node.optString("url")
                if (directUrl.startsWith("http", ignoreCase = true)) {
                    val isHls = looksLikeHls(directUrl) || keyHint.contains("hls", true)
                    val isMp4 = looksLikeMp4(directUrl) || keyHint.contains("mp4", true)
                    if ((isHls && allowHls) || (isMp4 && allowMp4)) {
                        output += Candidate(directUrl, isHls, nextFallback, 1)
                    }
                }
                node.keys().forEach { key ->
                    if (key != "url") {
                        collectRecursive(node.opt(key), key, nextFallback, output, allowMp4, allowHls, depth + 1)
                    }
                }
            }
        }
    }

    private fun inferHeight(node: JSONObject, keyHint: String, fallback: Int): Int {
        val candidates = listOf(
            node.optJSONObject("meta")?.optInt("h", 0),
            node.optJSONObject("meta")?.optInt("height", 0),
            node.optInt("h", 0),
            node.optInt("height", 0),
            node.optString("resolution").substringAfterLast('x', "").toIntOrNull(),
            keyHeight(keyHint),
            fallback,
        )
        return candidates.firstOrNull { it != null && it in 144..2160 } ?: fallback.coerceAtLeast(360)
    }

    private fun keyHeight(value: String): Int? = Regex("(?:^|[^0-9])(\\d{3,4})(?:p|[^0-9]|$)", RegexOption.IGNORE_CASE)
        .find(value)?.groupValues?.getOrNull(1)?.toIntOrNull()?.takeIf { it in 144..2160 }

    private fun heightDistance(height: Int, requestedHeight: Int): Int {
        if (height <= 0) return Int.MAX_VALUE / 2
        return if (height <= requestedHeight) requestedHeight - height else 10_000 + (height - requestedHeight)
    }

    private fun probe(candidate: Candidate, headers: Map<String, String>): Boolean = runCatching {
        val builder = Request.Builder().url(candidate.url).get()
        headers.forEach { (name, value) -> builder.header(name, value) }
        if (!candidate.hls) builder.header("Range", "bytes=0-0")
        http.newCall(builder.build()).execute().use { response ->
            when {
                candidate.hls -> response.isSuccessful
                response.code == 206 -> true
                response.code == 200 -> true
                else -> false
            }
        }
    }.getOrDefault(false)

    private fun rumbleHeaders(referer: String, includeOrigin: Boolean): Map<String, String> = buildMap {
        put("User-Agent", DESKTOP_USER_AGENT)
        put("Accept", "*/*")
        put("Accept-Encoding", "identity")
        put("Referer", referer)
        if (includeOrigin) put("Origin", "https://rumble.com")
    }

    private fun looksLikeMp4(value: String): Boolean = value.contains(".mp4", ignoreCase = true)
    private fun looksLikeHls(value: String): Boolean = value.contains(".m3u8", ignoreCase = true)

    companion object {
        private const val MAX_PROBED_CANDIDATES = 8
        private const val DESKTOP_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36"

        fun isRumbleUrl(value: String): Boolean = runCatching {
            val host = URI(value).host?.lowercase().orEmpty()
            host == "rumble.com" || host.endsWith(".rumble.com")
        }.getOrDefault(false)
    }
}

private class RumbleCookieJar : CookieJar {
    private val cookies = mutableListOf<Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        this.cookies.removeAll { it.expiresAt < now }
        cookies.forEach { incoming ->
            this.cookies.removeAll {
                it.name == incoming.name &&
                    it.domain == incoming.domain &&
                    it.path == incoming.path
            }
            if (incoming.expiresAt >= now) this.cookies += incoming
        }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        cookies.removeAll { it.expiresAt < now }
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    fun cookieHeader(url: String): String {
        val httpUrl = runCatching { HttpUrl.get(url) }.getOrNull() ?: return ""
        return loadForRequest(httpUrl).joinToString("; ") { "${it.name}=${it.value}" }
    }
}
