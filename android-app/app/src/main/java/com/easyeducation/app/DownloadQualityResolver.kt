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
) {
    val key: String get() = "$kind:$height:$sizeBytes"
}

class DownloadQualityResolver(
    private val context: Context,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
) {
    fun resolve(classId: String, sourceUrl: String): List<DownloadQualityOption> {
        val url = sourceUrl.trim()
        require(url.startsWith("https://")) { "This class does not have a secure downloadable source" }
        val raw = when {
            YoutubeDeviceResolver.isYoutubeUrl(url) -> resolveYouTube(url)
            isRumblePage(url) -> resolveRumble(classId, url)
            SecureDownloadCoordinator.isHlsSource(url) -> resolveHls(url)
            else -> resolveDirect(url)
        }
        require(raw.isNotEmpty()) { "No downloadable quality was found for this class" }
        val unique = raw
            .groupBy { it.height to it.kind }
            .map { (_, choices) -> choices.maxByOrNull { it.sizeBytes } ?: choices.first() }
            .sortedWith(compareBy<DownloadQualityOption> { it.height.takeIf { h -> h > 0 } ?: Int.MAX_VALUE })
        val recommendedHeight = unique.filter { it.height in 1..480 }.maxOfOrNull { it.height }
            ?: unique.firstOrNull()?.height
        return unique.map { it.copy(recommended = it.height == recommendedHeight) }
    }

    private fun resolveYouTube(url: String): List<DownloadQualityOption> {
        val result = YoutubeDeviceResolver(http).resolve(url)
        return result.formats.map { format ->
            DownloadQualityOption(
                height = format.height,
                label = format.qualityLabel.ifBlank { "${format.height}p" },
                sizeBytes = format.contentLength,
                estimated = format.contentLength <= 0,
                kind = "youtube",
            )
        }
    }

    private fun resolveRumble(classId: String, url: String): List<DownloadQualityOption> {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val endpoint = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(url)}"
        val payload = http.newCall(
            Request.Builder().url(endpoint).header("Authorization", "Bearer $token").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) error("Video quality lookup failed (${response.code})")
            JSONObject(response.body?.string().orEmpty())
        }
        val options = payload.optJSONArray("options") ?: return emptyList()
        val mp4 = buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: continue
                if (item.optString("kind", "mp4") != "mp4") continue
                val height = item.optInt("height", 0)
                if (height <= 0) continue
                val size = item.optLong("contentLength", 0)
                add(DownloadQualityOption(height, "${height}p", size, size <= 0, "rumble"))
            }
        }
        if (mp4.isNotEmpty()) return mp4

        return buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: continue
                if (item.optString("kind") != "hls") continue
                val height = item.optInt("height", 0)
                val playlist = item.optString("playlistUrl")
                if (height <= 0 || playlist.isBlank()) continue
                val estimatedSize = estimateHlsSize(playlist, item.optLong("bandwidth", 0))
                add(DownloadQualityOption(height, "${height}p", estimatedSize, true, "hls"))
            }
        }
    }

    private fun resolveHls(url: String): List<DownloadQualityOption> {
        val text = getText(url)
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
            val size = estimateHlsSize(variantUrl, bandwidth)
            variants += DownloadQualityOption(
                height = height,
                label = if (height > 0) "${height}p" else "Auto",
                sizeBytes = size,
                estimated = true,
                kind = "hls",
            )
        }
        if (variants.isNotEmpty()) return variants
        val size = estimateMediaPlaylistSize(lines, bandwidth = 0L)
        return listOf(DownloadQualityOption(0, "Source quality", size, true, "hls"))
    }

    private fun resolveDirect(url: String): List<DownloadQualityOption> {
        val size = probeLength(url)
        return listOf(DownloadQualityOption(0, "Original quality", size, size <= 0, "direct"))
    }

    private fun estimateHlsSize(url: String, bandwidth: Long): Long = runCatching {
        estimateMediaPlaylistSize(getText(url).lines(), bandwidth)
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

    private fun probeLength(url: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", YoutubeDeviceResolver.DOWNLOAD_USER_AGENT)
            .build()
        return http.newCall(request).execute().use { response ->
            val range = response.header("Content-Range").orEmpty()
            range.substringAfterLast('/', "").toLongOrNull()
                ?: response.header("Content-Length")?.toLongOrNull()?.takeIf { response.code == 206 }
                ?: 0L
        }
    }

    private fun getText(url: String): String = http.newCall(Request.Builder().url(url).build()).execute().use { response ->
        if (!response.isSuccessful) error("Video quality lookup returned HTTP ${response.code}")
        response.body?.string() ?: error("Video quality response was empty")
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
    }
}

object DownloadStoragePolicy {
    data class Check(val allowed: Boolean, val availableBytes: Long, val requiredBytes: Long, val message: String? = null)

    fun check(context: Context, option: DownloadQualityOption): Check {
        val available = StatFs(context.filesDir.absolutePath).availableBytes
        val base = option.sizeBytes
        val required = when {
            base <= 0L -> MIN_UNKNOWN_FREE_BYTES
            option.kind == "hls" -> (base * 3.25).toLong() + SAFETY_BYTES
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

    private const val SAFETY_BYTES = 96L * 1024L * 1024L
    private const val MIN_UNKNOWN_FREE_BYTES = 512L * 1024L * 1024L
}
