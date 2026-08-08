package com.easyeducation.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executors

private class DownloadPaused : Exception()

class HlsDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
    private lateinit var store: DownloadStore
    private var lastUiUpdate = 0L

    override fun onCreate() { super.onCreate(); store = DownloadStore(this); createChannel() }
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_ID)
        val tasks = if (id != null) listOfNotNull(store.get(id)) else store.pending()
        if (tasks.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        startForeground(notificationId(tasks.first().id), notification(tasks.first()))
        executor.execute {
            tasks.forEach { download(it) }
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
        return START_STICKY
    }

    private fun download(initial: DownloadTask) {
        var task = initial.copy(state = "downloading", error = null)
        store.save(task)
        try {
            val playlist = getBytes(initial.playlistUrl).decodeToString()
            val lines = playlist.lines()
            val segmentLineIndexes = lines.mapIndexedNotNull { index, line ->
                index.takeIf { line.isNotBlank() && !line.startsWith("#") }
            }
            val urls = segmentLineIndexes.map { URI(initial.playlistUrl).resolve(lines[it]).toString() }
            require(urls.isNotEmpty()) { "Playlist has no media segments" }

            val dir = offlineDir(initial.id).apply { mkdirs() }
            val start = (0 until urls.size)
                .firstOrNull { !segmentFile(dir, it).exists() } ?: urls.size
            var completedBytes = (0 until start).sumOf { segmentFile(dir, it).length() }
            val estimatedTotal = urls.sumOf(::rangeLength)
            val totalBytes = initial.totalBytes.takeIf { it > 0 } ?: estimatedTotal

            task = task.copy(
                downloadedBytes = completedBytes,
                totalBytes = totalBytes,
                completed = start,
                total = urls.size,
                state = "downloading",
            )
            store.save(task)
            if (start > 0) writePlaylist(lines, segmentLineIndexes, start, dir)
            updateUi(task, force = true)

            for (index in start until urls.size) {
                ensureRunning(task.id)
                val target = segmentFile(dir, index)
                val temp = File(dir, target.name + ".part")
                if (temp.exists()) temp.delete()

                http.newCall(Request.Builder().url(urls[index]).build()).execute().use { response ->
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
                    total = urls.size,
                )
                writePlaylist(lines, segmentLineIndexes, index + 1, dir)
                updateUi(task, force = true)
            }

            task = task.copy(
                downloadedBytes = if (totalBytes > 0) totalBytes else completedBytes,
                completed = urls.size,
                total = urls.size,
                state = "completed",
            )
            store.save(task)
            updateUi(task, force = true)
        } catch (_: DownloadPaused) {
            task = task.copy(state = "paused")
            store.save(task)
            updateUi(task, force = true)
        } catch (error: Throwable) {
            task = task.copy(state = "failed", error = error.message ?: "Download failed")
            store.save(task)
            updateUi(task, force = true)
        }
    }

    private fun ensureRunning(id: String) {
        if (store.get(id)?.state == "paused") throw DownloadPaused()
    }

    private fun updateUi(task: DownloadTask, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastUiUpdate < 400) return
        lastUiUpdate = now
        store.save(task)
        getSystemService(NotificationManager::class.java)
            .notify(notificationId(task.id), notification(task))
    }

    private fun writePlaylist(
        lines: List<String>,
        segmentLineIndexes: List<Int>,
        completed: Int,
        dir: File,
    ) {
        if (completed <= 0) return
        val cutoff = segmentLineIndexes[completed - 1] + 1
        var segment = 0
        val partial = lines.take(cutoff)
            .filter { it != "#EXT-X-ENDLIST" }
            .joinToString("\n") { line ->
                if (line.isBlank() || line.startsWith("#")) line
                else "segment-%06d.ts".format(segment++)
            }
        File(dir, "playlist.m3u8").writeText("${partial}\n#EXT-X-ENDLIST\n")
    }

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
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val detail = buildString {
            append("${task.height}p")
            if (task.downloadedBytes > 0 || task.totalBytes > 0) {
                append(" • ${formatBytes(task.downloadedBytes)}")
                if (task.totalBytes > 0) append(" / ${formatBytes(task.totalBytes)}")
            }
            if (task.courseTitle.isNotBlank()) append(" • ${task.courseTitle}")
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(if (task.state == "completed") android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
            .setContentTitle(task.title)
            .setContentText(if (task.state == "completed") "Download complete • ${detail}" else "${progress}% • ${detail}")
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setProgress(100, progress, task.totalBytes <= 0 && task.total <= 0)
            .setOngoing(task.state == "downloading")
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
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

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Video downloads", NotificationManager.IMPORTANCE_LOW))
    }

    companion object {
        private const val CHANNEL_ID = "video_downloads"
        private const val EXTRA_ID = "download_id"

        fun start(context: Context, id: String) = ContextCompat.startForegroundService(context,
            Intent(context, HlsDownloadService::class.java).putExtra(EXTRA_ID, id))

        fun resume(context: Context) {
            if (DownloadStore(context).pending().isEmpty()) return
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
        }

        fun safe(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)

        fun offlineDir(context: Context, id: String) = File(context.filesDir, "offline/${safe(id)}")
        fun notificationId(id: String) = safe(id).hashCode()
        fun segmentFile(dir: File, index: Int) = File(dir, "segment-%06d.ts".format(index))
    }

    private fun offlineDir(id: String) = offlineDir(this, id)
    private fun segmentFile(dir: File, index: Int) = Companion.segmentFile(dir, index)
    private fun notificationId(id: String) = Companion.notificationId(id)
}
