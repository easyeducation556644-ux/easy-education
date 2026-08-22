package com.easyeducation.app

import android.content.Context
import android.net.Uri
import android.os.StatFs
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

/** A source-reported quality option. sizeBytes is exact unless estimated=true. */
data class DownloadQualityOption(
    val height: Int,
    val label: String,
    val sizeBytes: Long,
    val estimated: Boolean,
    val kind: String,
    val recommended: Boolean = false,
    /** Stable provider URL or direct media URL used when the selected quality is queued. */
    val resolvedUrl: String = "",
) {
    val key: String get() = "$kind:$height:$sizeBytes:$resolvedUrl"
}

class DownloadQualityResolver(
    private val context: Context,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
) {
    fun resolve(classId: String, sourceUrl: String): List<DownloadQualityOption> {
        val url = sourceUrl.trim()
        require(url.startsWith("https://")) { "This class does not have a secure downloadable source" }
        val raw = when {
            YoutubeDeviceResolver.isYoutubeUrl(url) -> resolveYouTube(url)
            isRumblePage(url) -> resolveRumble(classId, url)
            isBunnyEmbed(url) -> resolveBunny(classId, url)
            SecureDownloadCoordinator.isHlsSource(url) -> resolveHls(url)
            else -> resolveDirect(url)
        }
        require(raw.isNotEmpty()) { "No downloadable quality was found for this class" }
        val unique = raw
            .groupBy { it.height }
            .map { (_, choices) ->
                choices.firstOrNull { it.kind == "bunny-hls" }
                    ?: choices.firstOrNull { it.kind == "rumble-hls" }
                    ?: choices.firstOrNull { it.kind == "rumble" }
                    ?: choices.firstOrNull { it.kind == "youtube" }
                    ?: choices.maxByOrNull { it.sizeBytes }
                    ?: choices.first()
            }
            .sortedWith(compareBy<DownloadQualityOption> { it.height.takeIf { h -> h > 0 } ?: Int.MAX_VALUE })
        val recommendedHeight = unique.filter { it.height in 1..480 }.maxOfOrNull { it.height }
            ?: unique.firstOrNull()?.height
        return unique.map { it.copy(recommended = it.height == recommendedHeight) }
    }

    private fun resolveYouTube(url: String): List<DownloadQualityOption> {
        val result = YoutubeDeviceResolver(http).resolve(url)
        return result.variants.map { variant ->
            DownloadQualityOption(
                height = variant.height,
                label = variant.qualityLabel.ifBlank { "${variant.height}p" },
                sizeBytes = variant.transferBytes,
                estimated = variant.transferBytes <= 0L,
                kind = "youtube",
            )
        }
    }

    /**
     * Bunny's CDN manifest may be signed/short-lived. Quality discovery uses the freshly resolved
     * CDN URL, but the queued task intentionally stores the stable embed URL. The HLS service then
     * re-resolves that embed every start/resume and reapplies Bunny's required request headers.
     */
    private fun resolveBunny(classId: String, embedUrl: String): List<DownloadQualityOption> {
        val resolved = NativePlaybackSourceResolver.resolveOnline(classId, embedUrl, 1080)
        val direct = resolved as? NativeOnlinePlaybackSource.Direct
            ?: error("Bunny did not expose a downloadable media source")
        return if (direct.hls || SecureDownloadCoordinator.isHlsSource(direct.url)) {
            resolveHls(direct.url, direct.requestHeaders).map { option ->
                option.copy(
                    kind = "bunny-hls",
                    // Persist the stable provider URL, never the expiring CDN manifest.
                    resolvedUrl = embedUrl,
                )
            }
        } else {
            resolveDirect(direct.url, direct.requestHeaders)
                .map { it.copy(kind = "bunny", resolvedUrl = direct.url) }
        }
    }

    private fun resolveRumble(classId: String, url: String): List<DownloadQualityOption> {
        val direct = runCatching {
            NativeRumbleDirectResolver(http).resolveAll(url)
        }.getOrNull().orEmpty()
        if (direct.isNotEmpty()) {
            val hls = direct.filter { it.hls }
            val selected = if (hls.isNotEmpty()) hls else direct.filter { !it.hls }
            val options = selected
                .filter { it.height > 0 || selected.size == 1 }
                .map { stream ->
                    DownloadQualityOption(
                        height = stream.height,
                        label = if (stream.height > 0) "${stream.height}p" else "Source quality",
                        sizeBytes = stream.contentLength,
                        estimated = stream.hls || stream.contentLength <= 0L,
                        kind = if (stream.hls) "rumble-hls" else "rumble",
                    )
                }
                .distinctBy { "${it.kind}:${it.height}" }
            if (options.isNotEmpty()) return options
        }
        return resolveRumbleServer(classId, url)
    }

    private fun resolveRumbleServer(classId: String, url: String): List<DownloadQualityOption> {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val endpoint = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(url)}"
        val payload = http.newCall(
            Request.Builder().url(endpoint).header("Authorization", "Bearer $token").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) {
                val detail = runCatching { JSONObject(response.body?.string().orEmpty()).optString("error") }.getOrNull()
                error(detail?.takeIf { it.isNotBlank() } ?: "Rumble quality lookup failed (${response.code})")
            }
            JSONObject(response.body?.string().orEmpty())
        }
        val options = payload.optJSONArray("options") ?: return emptyList()
        return buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: continue
                val kind = item.optString("kind", "mp4")
                val height = item.optInt("height", 0)
                if (height <= 0) continue
                val size = item.optLong("contentLength", 0L)
                when (kind) {
                    "mp4" -> add(DownloadQualityOption(height, "${height}p", size, size <= 0L, "rumble"))
                    "hls" -> add(DownloadQualityOption(height, "${height}p", size, true, "rumble-hls"))
                }
            }
        }
    }

    private fun resolveHls(
        url: String,
        headers: Map<String, String> = emptyMap(),
    ): List<DownloadQualityOption> {
        val text = getText(url, headers)
        val lines = text.lines()
        val variants = mutableListOf<DownloadQualityOption>()
        lines.forEachIndexed { index, line ->
            if (!line.startsWith("#EXT-X-STREAM-INF:")) return@forEachIndexed
            val next = lines.drop(index + 1).firstOrNull { it.isNotBlank() && !it.trimStart().startsWith("#") }
                ?: return@forEachIndexed
            val height = Regex("RESOLUTION=\\d+x(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
            val bandwidth = Regex("(?:AVERAGE-)?BANDWIDTH=(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
            val variantUrl = URI(url).resolve(next.trim()).toString()
            val size = estimateHlsSize(variantUrl, bandwidth, headers)
            variants += DownloadQualityOption(
                height = height,
                label = if (height > 0) "${height}p" else "Auto",
                sizeBytes = size,
                estimated = true,
                kind = "hls",
                resolvedUrl = variantUrl,
            )
        }
        if (variants.isNotEmpty()) return variants
        val size = estimateMediaPlaylistSize(lines, bandwidth = 0L)
        return listOf(DownloadQualityOption(0, "Source quality", size, true, "hls", resolvedUrl = url))
    }

    private fun resolveDirect(
        url: String,
        headers: Map<String, String> = emptyMap(),
    ): List<DownloadQualityOption> {
        val size = probeLength(url, headers)
        require(size > 0) { "This video server does not support safe resumable offline downloads." }
        return listOf(DownloadQualityOption(0, "Original quality", size, false, "direct", resolvedUrl = url))
    }

    private fun estimateHlsSize(
        url: String,
        bandwidth: Long,
        headers: Map<String, String>,
    ): Long = runCatching {
        estimateMediaPlaylistSize(getText(url, headers).lines(), bandwidth)
    }.getOrDefault(0L)

    private fun estimateMediaPlaylistSize(lines: List<String>, bandwidth: Long): Long {
        val durations = lines.mapNotNull { line ->
            if (!line.startsWith("#EXTINF:")) null
            else line.substringAfter(':').substringBefore(',').toDoubleOrNull()
        }
        val seconds = durations.sum()
        if (seconds <= 0 || bandwidth <= 0) return 0L
        return ((bandwidth.toDouble() / 8.0) * seconds).toLong().coerceAtLeast(0L)
    }

    private fun probeLength(
        url: String,
        headers: Map<String, String> = emptyMap(),
    ): Long {
        val builder = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", YoutubeDeviceResolver.DOWNLOAD_USER_AGENT)
        headers.forEach { (name, value) -> if (name.isNotBlank() && value.isNotBlank()) builder.header(name, value) }
        return http.newCall(builder.build()).execute().use { response ->
            if (response.code != 206) return@use 0L
            val range = response.header("Content-Range").orEmpty()
            range.substringAfterLast('/', "").toLongOrNull() ?: 0L
        }
    }

    private fun getText(url: String, headers: Map<String, String> = emptyMap()): String {
        val builder = Request.Builder().url(url)
        headers.forEach { (name, value) -> if (name.isNotBlank() && value.isNotBlank()) builder.header(name, value) }
        return http.newCall(builder.build()).execute().use { response ->
            if (!response.isSuccessful) error("Video quality lookup returned HTTP ${response.code}")
            response.body?.string() ?: error("Video quality response was empty")
        }
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    private fun isBunnyEmbed(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "mediadelivery.net" || host.endsWith(".mediadelivery.net")
    }.getOrDefault(false)

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
    }
}

object DownloadStoragePolicy {
    data class Check(
        val allowed: Boolean,
        val availableBytes: Long,
        val requiredBytes: Long,
        val message: String? = null,
    )

    fun check(context: Context, option: DownloadQualityOption): Check {
        val available = StatFs(context.filesDir.absolutePath).availableBytes
        val base = option.sizeBytes
        val required = when {
            base <= 0L -> MIN_UNKNOWN_FREE_BYTES
            option.kind.contains("hls") -> (base * 3.25).toLong() + SAFETY_BYTES
            option.kind == "youtube" -> (base * 2.35).toLong() + SAFETY_BYTES
            else -> (base * 1.15).toLong() + SAFETY_BYTES
        }
        return if (available >= required) {
            Check(true, available, required)
        } else {
            Check(
                false,
                available,
                required,
                "Not enough storage. Need about ${DownloadNotifier.formatBytes(required)}, available ${DownloadNotifier.formatBytes(available)}.",
            )
        }
    }

    fun checkTask(context: Context, task: SecureDownloadTask): Check {
        val option = DownloadQualityOption(
            height = task.height,
            label = task.qualityLabel,
            sizeBytes = task.expectedBytes.takeIf { it > 0 } ?: task.totalBytes,
            estimated = task.sizeEstimated,
            kind = task.sourceKind,
        )
        return check(context, option)
    }

    private const val SAFETY_BYTES = 128L * 1024L * 1024L
    private const val MIN_UNKNOWN_FREE_BYTES = 768L * 1024L * 1024L
}
