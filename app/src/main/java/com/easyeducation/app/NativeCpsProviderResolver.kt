package com.easyeducation.app

import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * CPS provider bridge. A CPS class may say Bunny while the URL is actually YouTube (and vice versa),
 * so routing is based on the URL first and cdnType only as a hint. Embed pages are resolved to an
 * actual media URL before NativeInlinePlayer sees them, keeping playback on our Media3 player.
 */
object NativeCpsProviderResolver {
    private val cache = ConcurrentHashMap<String, String>()
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun resolve(rawUrl: String, cdnType: String = ""): String {
        val source = rawUrl.trim()
        if (source.isBlank()) return ""
        cache[source]?.let { return it }
        val resolved = withContext(Dispatchers.IO) { resolveBlocking(source, cdnType) }
        if (resolved.isNotBlank()) cache[source] = resolved
        return resolved
    }

    private fun resolveBlocking(source: String, cdnType: String): String {
        val lower = source.lowercase()
        if (
            YoutubeDeviceResolver.isYoutubeUrl(source) ||
            RumbleDeviceResolver.isRumbleUrl(source) ||
            lower.contains(".m3u8") || lower.contains(".mp4") || lower.contains(".webm")
        ) return source

        val uri = runCatching { Uri.parse(source) }.getOrNull() ?: return source
        val host = uri.host.orEmpty().lowercase()
        val looksEmbedded = host.contains("mediadelivery.net") ||
            uri.path.orEmpty().contains("/embed/", true) ||
            cdnType.contains("bunny", true) ||
            cdnType.contains("iframe", true)
        if (!looksEmbedded) return source

        return runCatching {
            val body = http.newCall(
                Request.Builder()
                    .url(source)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
                    .header("Referer", source)
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) error("Provider page failed (${response.code})")
                response.body?.string().orEmpty()
            }
            extractMediaUrl(body, source).ifBlank { source }
        }.getOrDefault(source)
    }

    private fun extractMediaUrl(rawBody: String, pageUrl: String): String {
        val body = rawBody
            .replace("\\u0026", "&", ignoreCase = true)
            .replace("\\/", "/")
            .replace("&amp;", "&")

        val absolutePatterns = listOf(
            Regex("https?://[^\\\"'<>\\s]+\\.m3u8[^\\\"'<>\\s]*", RegexOption.IGNORE_CASE),
            Regex("https?://[^\\\"'<>\\s]+\\.mp4[^\\\"'<>\\s]*", RegexOption.IGNORE_CASE),
        )
        absolutePatterns.forEach { pattern ->
            pattern.find(body)?.value?.trim()?.takeIf { it.startsWith("http") }?.let { return it }
        }

        val relative = Regex("[\\\"']([^\\\"']+\\.(?:m3u8|mp4)(?:\\?[^\\\"']*)?)[\\\"']", RegexOption.IGNORE_CASE)
            .find(body)?.groupValues?.getOrNull(1).orEmpty()
        if (relative.isNotBlank()) {
            return runCatching {
                val base = java.net.URI(pageUrl)
                base.resolve(relative).toString()
            }.getOrDefault("")
        }
        return ""
    }

    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"
}
