package com.easyeducation.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private class DownloadPaused : Exception()

private data class SegmentSpec(
    val sourceUrl: String,
    val fileName: String,
)

class HlsDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var store: DownloadStore
    private var lastUiUpdate = 0L
    @Volatile private var activeTransformer: Transformer? = null

    override fun onCreate() {
        super.onCreate()
        store = DownloadStore(this)
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_ID)
        val tasks = if (id != null) {
            listOfNotNull(store.get(id))
        } else {
            store.all().filter { task ->
                task.state in setOf("queued", "downloading", "converting") || needsLegacyConversion(task)
            }
        }
        if (tasks.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(notificationId(tasks.first().id), notification(tasks.first()))
        executor.execute {
            tasks.forEach { downloadOrConvert(it) }
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
        return START_STICKY
    }

    private fun downloadOrConvert(initial: DownloadTask) {
        val dir = offlineDir(initial.id).apply { mkdirs() }
        val mp4 = File(dir, MP4_NAME)
        if (mp4.exists() && mp4.length() > 0) {
            val completed = initial.copy(
                downloadedBytes = initial.totalBytes.takeIf { it > 0 } ?: mp4.length(),
                state = "completed",
                error = null,
            )
            store.save(completed)
            updateUi(completed, force = true)
            return
        }

        if (initial.kind == "mp4") {
            downloadMp4(initial, dir)
        } else {
            downloadHlsAndConvert(initial, dir)
        }
    }

    private fun downloadMp4(initial: DownloadTask, dir: File) {
        var task = initial.copy(state = "downloading", error = null)
        store.save(task)
        try {
            require(initial.downloadUrlBase.isNotBlank()) { "MP4 download source is missing" }
            require(initial.totalBytes > 0) { "MP4 size is unavailable" }

            val output = File(dir, MP4_NAME)
            val temp = File(dir, "$MP4_NAME.part")
            if (output.exists()) output.delete()
            if (temp.length() > initial.totalBytes) temp.delete()

            var completedBytes = temp.length()
            task = task.copy(
                downloadedBytes = completedBytes,
                totalBytes = initial.totalBytes,
                state = "downloading",
            )
            store.save(task)
            updateUi(task, force = true)

            FileOutputStream(temp, true).use { fileOut ->
                while (completedBytes < initial.totalBytes) {
                    ensureRunning(task.id)
                    val start = completedBytes
                    val end = minOf(initial.totalBytes - 1, start + MP4_CHUNK_BYTES - 1)
                    val chunkUrl = appendRange(initial.downloadUrlBase, start, end)
                    http.newCall(Request.Builder().url(chunkUrl).build()).execute().use { response ->
                        check(response.isSuccessful) { "MP4 chunk returned HTTP ${response.code}" }
                        val body = response.body ?: error("MP4 chunk was empty")
                        val expected = end - start + 1
                        var chunkBytes = 0L
                        body.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                ensureRunning(task.id)
                                val count = input.read(buffer)
                                if (count < 0) break
                                fileOut.write(buffer, 0, count)
                                chunkBytes += count
                                task = task.copy(downloadedBytes = start + chunkBytes)
                                updateUi(task)
                            }
                        }
                        check(chunkBytes == expected) {
                            "MP4 chunk was incomplete (${chunkBytes}/${expected} bytes)"
                        }
                    }
                    completedBytes = end + 1
                    fileOut.flush()
                    task = task.copy(downloadedBytes = completedBytes)
                    updateUi(task, force = true)
                }
            }

            check(temp.length() == initial.totalBytes) { "Downloaded MP4 size did not match" }
            check(temp.renameTo(output)) { "Could not finalize MP4 file" }
            cleanupExceptMp4(dir)
            task = task.copy(
                downloadedBytes = initial.totalBytes,
                completed = 1,
                total = 1,
                state = "completed",
                error = null,
            )
            store.save(task)
            updateUi(task, force = true)
        } catch (_: DownloadPaused) {
            task = task.copy(state = "paused")
            store.save(task)
            updateUi(task, force = true)
        } catch (error: Throwable) {
            task = task.copy(state = "failed", error = error.message ?: "MP4 download failed")
            store.save(task)
            updateUi(task, force = true)
        }
    }

    private fun downloadHlsAndConvert(initial: DownloadTask, dir: File) {
        var task = initial.copy(state = if (needsLegacyConversion(initial)) "converting" else "downloading", error = null)
        store.save(task)
        try {
            require(initial.playlistUrl.isNotBlank()) { "HLS playlist source is missing" }
            val playlistText = getBytes(initial.playlistUrl).decodeToString()
            val lines = playlistText.lines()
            val segmentLineIndexes = lines.mapIndexedNotNull { index, line ->
                index.takeIf { line.isNotBlank() && !line.startsWith("#") }
            }
            val urls = segmentLineIndexes.map { URI(initial.playlistUrl).resolve(lines[it]).toString() }
            require(urls.isNotEmpty()) { "Playlist has no media segments" }
            val specs = urls.mapIndexed { index, url ->
                SegmentSpec(url, localSegmentName(index, url))
            }

            migrateLegacySegments(dir, specs)
            val start = specs.indexOfFirst { !File(dir, it.fileName).exists() }
                .let { if (it < 0) specs.size else it }
            var completedBytes = specs.take(start).sumOf { File(dir, it.fileName).length() }
            val estimatedTotal = urls.sumOf(::rangeLength)
            val totalBytes = initial.totalBytes.takeIf { it > 0 } ?: estimatedTotal

            if (start < specs.size) {
                task = task.copy(
                    downloadedBytes = completedBytes,
                    totalBytes = totalBytes,
                    completed = start,
                    total = specs.size,
                    state = "downloading",
                )
                store.save(task)
                updateUi(task, force = true)
            }

            for (index in start until specs.size) {
                ensureRunning(task.id)
                val target = File(dir, specs[index].fileName)
                val temp = File(dir, target.name + ".part")
                if (temp.exists()) temp.delete()

                http.newCall(Request.Builder().url(specs[index].sourceUrl).build()).execute().use { response ->
                    check(response.isSuccessful) { "Segment ${index + 1} returned HTTP ${response.code}" }
                    val body = response.body ?: error("Segment ${index + 1} was empty")
                    body.byteStream().use { input ->
                        temp.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var segmentBytes = 0L
                            while (true) {
                                ensureRunning(task.id)
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                                segmentBytes += count
                                task = task.copy(
                                    downloadedBytes = completedBytes + segmentBytes,
                                    totalBytes = totalBytes,
                                )
                                updateUi(task)
                            }
                        }
                    }
                }

                check(temp.renameTo(target)) { "Could not save segment ${index + 1}" }
                completedBytes += target.length()
                task = task.copy(
                    downloadedBytes = completedBytes,
                    totalBytes = totalBytes,
                    completed = index + 1,
                    total = specs.size,
                )
                updateUi(task, force = true)
            }

            val localizedLines = localizeAuxiliaryUris(lines, initial.playlistUrl, dir)
            writeFinalPlaylist(localizedLines, segmentLineIndexes, specs, dir)

            task = task.copy(
                downloadedBytes = totalBytes.takeIf { it > 0 } ?: completedBytes,
                completed = specs.size,
                total = specs.size,
                state = "converting",
                error = null,
            )
            store.save(task)
            updateUi(task, force = true)

            convertLocalHlsToMp4(task, dir)
            val mp4 = File(dir, MP4_NAME)
            check(mp4.exists() && mp4.length() > 0) { "MP4 conversion produced no video" }
            cleanupExceptMp4(dir)

            task = task.copy(
                state = "completed",
                error = null,
                downloadedBytes = totalBytes.takeIf { it > 0 } ?: mp4.length(),
            )
            store.save(task)
            updateUi(task, force = true)
        } catch (_: DownloadPaused) {
            cancelTransformer()
            task = task.copy(state = "paused")
            store.save(task)
            updateUi(task, force = true)
        } catch (error: Throwable) {
            cancelTransformer()
            task = task.copy(state = "failed", error = error.message ?: "Download or MP4 conversion failed")
            store.save(task)
            updateUi(task, force = true)
        }
    }

    @OptIn(UnstableApi::class)
    private fun convertLocalHlsToMp4(task: DownloadTask, dir: File) {
        val playlist = File(dir, PLAYLIST_NAME)
        require(playlist.exists()) { "Local HLS playlist is missing" }
        val output = File(dir, MP4_NAME)
        val temp = File(dir, "$MP4_NAME.export")
        if (output.exists()) output.delete()
        if (temp.exists()) temp.delete()

        val done = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>(null)
        mainHandler.post {
            try {
                val mediaItem = MediaItem.Builder()
                    .setUri(Uri.fromFile(playlist))
                    .setMimeType(MimeTypes.APPLICATION_M3U8)
                    .build()
                val transformer = Transformer.Builder(this)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            activeTransformer = null
                            done.countDown()
                        }

                        override fun onError(
                            composition: Composition,
                            exportResult: ExportResult,
                            exportException: ExportException,
                        ) {
                            failure.set(exportException)
                            activeTransformer = null
                            done.countDown()
                        }
                    })
                    .build()
                activeTransformer = transformer
                transformer.start(mediaItem, temp.absolutePath)
            } catch (error: Throwable) {
                failure.set(error)
                activeTransformer = null
                done.countDown()
            }
        }

        while (!done.await(500, TimeUnit.MILLISECONDS)) {
            ensureRunning(task.id)
        }
        failure.get()?.let { throw it }
        check(temp.exists() && temp.length() > 0) { "MP4 export failed" }
        check(temp.renameTo(output)) { "Could not finalize converted MP4" }
    }

    private fun cancelTransformer() {
        val transformer = activeTransformer ?: return
        mainHandler.post {
            runCatching { transformer.cancel() }
            if (activeTransformer === transformer) activeTransformer = null
        }
    }

    private fun ensureRunning(id: String) {
        if (store.get(id)?.state == "paused") throw DownloadPaused()
    }

    private fun updateUi(task: DownloadTask, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastUiUpdate < 250) return
        lastUiUpdate = now
        store.save(task)
        getSystemService(NotificationManager::class.java)
            .notify(notificationId(task.id), notification(task))
    }

    private fun writeFinalPlaylist(
        lines: List<String>,
        segmentLineIndexes: List<Int>,
        specs: List<SegmentSpec>,
        dir: File,
    ) {
        val byLine = segmentLineIndexes.mapIndexed { index, line -> line to specs[index].fileName }.toMap()
        val local = lines.mapIndexed { index, line -> byLine[index] ?: line }
        File(dir, PLAYLIST_NAME).writeText(local.joinToString("\n"))
    }

    private fun localizeAuxiliaryUris(lines: List<String>, playlistUrl: String, dir: File): List<String> {
        val uriRegex = Regex("URI=\"([^\"]+)\"")
        return lines.map { line ->
            if (!line.startsWith("#EXT-X-MAP:") && !line.startsWith("#EXT-X-KEY:")) return@map line
            val match = uriRegex.find(line) ?: return@map line
            val raw = match.groupValues[1]
            if (raw.isBlank()) return@map line
            val source = URI(playlistUrl).resolve(raw).toString()
            val ext = extensionForUrl(source, "bin")
            val localName = "aux-${safe(source).take(16)}.$ext"
            val target = File(dir, localName)
            if (!target.exists()) target.writeBytes(getBytes(source))
            line.replaceRange(match.range, "URI=\"$localName\"")
        }
    }

    private fun migrateLegacySegments(dir: File, specs: List<SegmentSpec>) {
        specs.forEachIndexed { index, spec ->
            val target = File(dir, spec.fileName)
            if (target.exists()) return@forEachIndexed
            val legacy = legacySegmentFile(dir, index)
            if (legacy.exists() && legacy.length() > 0) {
                if (!legacy.renameTo(target)) legacy.copyTo(target, overwrite = true)
            }
        }
    }

    private fun localSegmentName(index: Int, url: String): String =
        "segment-%06d.%s".format(index, extensionForUrl(url, "ts"))

    private fun extensionForUrl(url: String, fallback: String): String = runCatching {
        val path = URI(url).path ?: ""
        val ext = path.substringAfterLast('.', "").lowercase()
        if (ext.matches(Regex("[a-z0-9]{1,5}"))) ext else fallback
    }.getOrDefault(fallback)

    private fun getBytes(url: String): ByteArray {
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code}" }
            return response.body?.bytes() ?: error("Empty response")
        }
    }

    private fun notification(task: DownloadTask): Notification {
        val progress = when {
            task.totalBytes > 0 -> (task.downloadedBytes * 100 / task.totalBytes).toInt().coerceIn(0, 100)
            task.total > 0 -> (task.completed * 100 / task.total).coerceIn(0, 100)
            else -> 0
        }
        val openDownloads = PendingIntent.getActivity(
            this,
            notificationId(task.id),
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_PATH, "/downloads")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val detail = buildString {
            append("${task.height}p")
            if (task.downloadedBytes > 0 || task.totalBytes > 0) {
                append(" • ${formatBytes(task.downloadedBytes)}")
                if (task.totalBytes > 0) append(" / ${formatBytes(task.totalBytes)}")
            }
            if (task.courseTitle.isNotBlank()) append(" • ${task.courseTitle}")
        }

        if (task.state == "completed") {
            val play = PendingIntent.getActivity(
                this,
                notificationId(task.id) xor 0x4A17,
                Intent(this, OfflinePlayerActivity::class.java)
                    .putExtra(OfflinePlayerActivity.EXTRA_ID, task.id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val completedText = buildString {
                append(task.title)
                if (task.courseTitle.isNotBlank()) append(" • ${task.courseTitle}")
                append(" • ${task.height}p")
            }
            return NotificationCompat.Builder(this, COMPLETE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Download completed")
                .setContentText(completedText)
                .setStyle(NotificationCompat.BigTextStyle().bigText(completedText))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setOngoing(false)
                .setOnlyAlertOnce(false)
                .setContentIntent(openDownloads)
                .addAction(android.R.drawable.ic_media_play, "Play", play)
                .build()
        }

        val status = when (task.state) {
            "converting" -> "Preparing MP4 video"
            "paused" -> "Download paused"
            "failed" -> "Download failed"
            else -> "${progress}%"
        }
        return NotificationCompat.Builder(this, PROGRESS_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(task.title)
            .setContentText("$status • $detail")
            .setStyle(NotificationCompat.BigTextStyle().bigText("$status • $detail"))
            .setProgress(100, progress, task.totalBytes <= 0 && task.total <= 0)
            .setOngoing(task.state in setOf("downloading", "converting"))
            .setOnlyAlertOnce(true)
            .setAutoCancel(task.state in setOf("paused", "failed"))
            .setContentIntent(openDownloads)
            .build()
    }

    private fun appendRange(base: String, start: Long, end: Long): String {
        val separator = if (base.contains('?')) '&' else '?'
        return "$base${separator}start=$start&end=$end"
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024 * 1024 -> "%.1f GB".format(bytes.toDouble() / (1024L * 1024 * 1024))
        bytes >= 1024L * 1024 -> "%.1f MB".format(bytes.toDouble() / (1024L * 1024))
        else -> "${bytes / 1024} KB"
    }

    private fun rangeLength(url: String): Long = runCatching {
        val value = URI(url).query?.split("&")?.firstOrNull { it.startsWith("r_range=") }
            ?.substringAfter("=") ?: return 0
        val parts = value.split("-").map(String::toLong)
        parts[1] - parts[0] + 1
    }.getOrDefault(0)

    private fun cleanupExceptMp4(dir: File) {
        dir.listFiles()?.forEach { if (it.name != MP4_NAME) it.deleteRecursively() }
    }

    private fun needsLegacyConversion(task: DownloadTask): Boolean {
        if (task.kind != "hls" || task.state != "completed") return false
        val dir = offlineDir(task.id)
        return !File(dir, MP4_NAME).exists() && File(dir, PLAYLIST_NAME).exists()
    }

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(PROGRESS_CHANNEL_ID, "Video downloads", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(COMPLETE_CHANNEL_ID, "Completed downloads", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    companion object {
        private const val PROGRESS_CHANNEL_ID = "video_downloads"
        private const val COMPLETE_CHANNEL_ID = "video_download_complete"
        private const val EXTRA_ID = "download_id"
        private const val MP4_NAME = "video.mp4"
        private const val PLAYLIST_NAME = "playlist.m3u8"
        private const val MP4_CHUNK_BYTES = 8L * 1024 * 1024

        fun start(context: Context, id: String) = ContextCompat.startForegroundService(
            context,
            Intent(context, HlsDownloadService::class.java).putExtra(EXTRA_ID, id),
        )

        fun resume(context: Context) {
            val store = DownloadStore(context)
            val hasWork = store.pending().isNotEmpty() || store.all().any { task ->
                task.kind == "hls" && task.state == "completed" &&
                    !File(offlineDir(context, task.id), MP4_NAME).exists() &&
                    File(offlineDir(context, task.id), PLAYLIST_NAME).exists()
            }
            if (!hasWork) return
            ContextCompat.startForegroundService(context, Intent(context, HlsDownloadService::class.java))
        }

        fun pause(context: Context, id: String) {
            val store = DownloadStore(context)
            store.get(id)?.let { store.save(it.copy(state = "paused")) }
        }

        fun remove(context: Context, id: String) {
            pause(context, id)
            offlineDir(context, id).deleteRecursively()
            DownloadStore(context).remove(id)
            context.getSystemService(NotificationManager::class.java).cancel(notificationId(id))
        }

        fun safe(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)

        fun offlineDir(context: Context, id: String) = File(context.filesDir, "offline/${safe(id)}")
        fun notificationId(id: String) = safe(id).hashCode()
        fun legacySegmentFile(dir: File, index: Int) = File(dir, "segment-%06d.ts".format(index))
    }

    private fun offlineDir(id: String) = offlineDir(this, id)
    private fun legacySegmentFile(dir: File, index: Int) = Companion.legacySegmentFile(dir, index)
    private fun notificationId(id: String) = Companion.notificationId(id)
}
