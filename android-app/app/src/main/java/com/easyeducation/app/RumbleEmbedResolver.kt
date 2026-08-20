package com.easyeducation.app

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class RumbleEmbedResolver(
    private val client: OkHttpClient = OkHttpClient(),
) {
    fun resolve(videoUrl: String): String {
        val source = normalizeRumbleUrl(videoUrl, requireEmbed = false)
            ?: error("Invalid Rumble video URL")
        if (URI(source).path.startsWith("/embed/", ignoreCase = true)) return source

        val encoded = URLEncoder.encode(source, StandardCharsets.UTF_8.toString())
        val oEmbedRequest = Request.Builder()
            .url("https://rumble.com/api/Media/oembed.json?url=$encoded")
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .build()

        client.newCall(oEmbedRequest).execute().use { response ->
            if (response.isSuccessful) {
                val html = runCatching {
                    JSONObject(response.body?.string().orEmpty()).optString("html")
                }.getOrDefault("")
                extractEmbedUrl(html)?.let { return it }
            }
        }

        val pageRequest = Request.Builder()
            .url(source)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml")
            .build()
        client.newCall(pageRequest).execute().use { response ->
            if (!response.isSuccessful) error("Rumble page returned HTTP ${response.code}")
            extractEmbedUrl(response.body?.string().orEmpty())?.let { return it }
        }

        error("Unable to resolve the canonical Rumble embed URL")
    }

    private fun extractEmbedUrl(value: String): String? {
        val text = value
            .replace("\\u002F", "/", ignoreCase = true)
            .replace("\\/", "/")
        for (pattern in EMBED_PATTERNS) {
            val match = pattern.find(text) ?: continue
            val raw = match.groups.getOrNull(1)?.value ?: match.value
            val decoded = raw
                .replace("&amp;", "&", ignoreCase = true)
                .replace("&#38;", "&", ignoreCase = true)
                .let { if (it.startsWith("//")) "https:$it" else it }
            normalizeRumbleUrl(decoded, requireEmbed = true)?.let { return it }
        }
        return null
    }

    private fun normalizeRumbleUrl(value: String, requireEmbed: Boolean): String? = runCatching {
        val uri = URI(value.trim())
        val host = uri.host?.lowercase() ?: return null
        if (uri.scheme != "https") return null
        if (host != "rumble.com" && !host.endsWith(".rumble.com")) return null
        if (requireEmbed && !uri.path.startsWith("/embed/", ignoreCase = true)) return null
        uri.toString()
    }.getOrNull()

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"

        private val EMBED_PATTERNS = listOf(
            Regex("""<iframe\b[^>]*\bsrc=[\"']([^\"']*rumble\.com/embed/[^\"']+)[\"']""", RegexOption.IGNORE_CASE),
            Regex("""[\"']embedUrl[\"']\s*:\s*[\"']([^\"']*rumble\.com/embed/[^\"']+)[\"']""", RegexOption.IGNORE_CASE),
            Regex("""(https?://rumble\.com/embed/[^\"'\s<]+)""", RegexOption.IGNORE_CASE),
        )
    }
}
