package com.easyeducation.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private class YoutubeDownloadPaused : Exception()

/**
 * Low-memory YouTube download worker.
 *
 * Only one task is processed at a time. Network bytes are copied directly to the app-private
 * file using a 32 KiB buffer, so video size does not translate into RAM usage.
 */
class YoutubeDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private lateinit var store: DownloadStore
    private var lastUiUpdate = 0L

    override fun onCreate() {
        super.onCreate()
        store = DownloadStore(this)
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedId = intent?.getStringExtra(EXTRA_ID)
        val tasks = if (requestedId != null) {
            listOfNotNull(store.get(requestedId)).filter { it.kind == KIND }
        } else {
            store.all().filter {
                it.kind == KIND && it.state in setOf("queued", "yt_resolving", "yt_downloading")
            }
        }

        if (tasks.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(notificationId(tasks.first().id), notification(tasks.first()))
        executor.execute {
            tasks.forEach(::download)
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
        return START_STICKY
    }

    private fun download(initial: DownloadTask) {
        val dir = HlsDownloadService.offlineDir(this, initial.id).apply { mkdirs() }
        val finalFile = File(dir, MP4_NAME)
        val partialFile = File(dir, "$MP4_NAME.part")

        if (finalFile.exists() && finalFile.length() > 0) {
            val completed = initial.copy(
                downloadedBytes = finalFile.length(),
                totalBytes = initial.totalBytes.takeIf { it > 0 } ?: finalFile.length(),
                completed = 1,
                total = 1,
                state = "completed",
                error = null,
            )
            store.save(completed)
            updateUi(completed, force = true)
            return
        }

        var task = initial.copy(state = "yt_resolving", error = null)
        store.save(task)
        updateUi(task, force = true)

        try {
            require(YoutubeDeviceResolver.isYoutubeUrl(initial.playlistUrl)) {
                "YouTube source URL is missing or invalid"
            }

            var selected = YoutubeDeviceResolver()
                .pickFormat(initial.playlistUrl, initial.height).second
            var retriedExpiredUrl = false

            downloadLoop@ while (true) {
                ensureRunning(task.id)
                if (selected.contentLength > 0 && partialFile.length() > selected.contentLength) {
                    partialFile.delete()
                }
                val offset = partialFile.length()
                var retryLoop = false

                val request = Request.Builder()
                    .url(selected.url)
                    .header("User-Agent", YoutubeDeviceResolver.DOWNLOAD_USER_AGENT)
                    .apply { if (offset > 0) header("Range", "bytes=$offset-") }
                    .get()
                    .build()

                http.newCall(request).execute().use { response ->
                    if (response.code in setOf(403, 410) && !retriedExpiredUrl) {
                        retriedExpiredUrl = true
                        task = task.copy(state = "yt_resolving", error = null)
                        store.save(task)
                        updateUi(task, force = true)
                        selected = YoutubeDeviceResolver()
                            .pickFormat(initial.playlistUrl, initial.height).second
                        retryLoop = true
                        return@use
                    }
                    check(response.isSuccessful) { "YouTube video returned HTTP ${response.code}" }

                    // A server ignoring our resume Range would duplicate the existing prefix.
                    if (offset > 0 && response.code == 200) {
                        partialFile.delete()
                        retryLoop = true
                        return@use
                    }

                    val body = response.body ?: error("YouTube video response was empty")
                    val totalBytes = resolveTotalBytes(
                        contentRange = response.header("Content-Range"),
                        responseLength = body.contentLength(),
                        offset = offset,
                        expected = selected.contentLength,
                    )
                    task = task.copy(
                        height = selected.height,
                        downloadedBytes = offset,
                        totalBytes = totalBytes,
                        state = "yt_downloading",
                        error = null,
                    )
                    store.save(task)
                    updateUi(task, force = true)

                    FileOutputStream(partialFile, offset > 0).use { output ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(STREAM_BUFFER_BYTES)
                            var downloaded = offset
                            while (true) {
                                ensureRunning(task.id)
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                                downloaded += count
                                task = task.copy(downloadedBytes = downloaded)
                                updateUi(task)
                            }
                            output.flush()
                        }
                    }
                }

                if (retryLoop) continue@downloadLoop
                val expected = selected.contentLength.takeIf { it > 0 }
                    ?: task.totalBytes.takeIf { it > 0 }
                if (expected != null && partialFile.length() < expected) continue@downloadLoop
                break@downloadLoop
            }

            ensureRunning(task.id)
            check(partialFile.exists() && partialFile.length() > 0) { "Downloaded YouTube MP4 is empty" }
            val expected = selected.contentLength.takeIf { it > 0 }
                ?: task.totalBytes.takeIf { it > 0 }
            if (expected != null) {
                check(partialFile.length() == expected) {
                    "YouTube download was incomplete (${partialFile.length()}/$expected bytes)"
                }
            }

            if (finalFile.exists()) finalFile.delete()
            check(partialFile.renameTo(finalFile)) { "Could not finalize YouTube MP4" }
            cleanupExceptMp4(dir)

            task = task.copy(
                height = selected.height,
                downloadedBytes = finalFile.length(),
                totalBytes = finalFile.length(),
                completed = 1,
                total = 1,
                state = "completed",
                error = null,
            )
            store.save(task)
            updateUi(task, force = true)
        } catch (_: YoutubeDownloadPaused) {
            task = task.copy(state = "paused", downloadedBytes = partialFile.length())
            store.save(task)
            updateUi(task, force = true)
        } catch (error: Throwable) {
            task = task.copy(
                state = "failed",
                downloadedBytes = partialFile.length(),
                error = error.message ?: "YouTube download failed",
            )
            store.save(task)
            updateUi(task, force = true)
        }
    }

    private fun resolveTotalBytes(
        contentRange: String?,
        responseLength: Long,
        offset: Long,
        expected: Long,
    ): Long {
        val fromRange = contentRange.orEmpty().substringAfterLast('/', "").toLongOrNull()
        if (fromRange != null && fromRange > 0) return fromRange
        if (expected > 0) return expected
        if (responseLength > 0) return offset + responseLength
        return 0L
    }

    private fun ensureRunning(id: String) {
        if (store.get(id)?.state == "paused") throw YoutubeDownloadPaused()
    }

    private fun updateUi(task: DownloadTask, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastUiUpdate < UI_UPDATE_MS) return
        lastUiUpdate = now
        store.save(task)
        getSystemService(NotificationManager::class.java)
            .notify(notificationId(task.id), notification(task))
    }

    private fun notification(task: DownloadTask): Notification {
        val progress = if (task.totalBytes > 0) {
            (task.downloadedBytes * 100 / task.totalBytes).toInt().coerceIn(0, 100)
        } else 0
        val openDownloads = PendingIntent.getActivity(
            this,
            notificationId(task.id),
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_PATH, "/downloads")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

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
            "yt_resolving" -> "YouTube quality preparing"
            "paused" -> "Download paused"
            "failed" -> "Download failed"
            else -> if (task.totalBytes > 0) "$progress%" else "Downloading"
        }
        val detail = buildString {
            append("${task.height}p")
            if (task.downloadedBytes > 0 || task.totalBytes > 0) {
                append(" • ${formatBytes(task.downloadedBytes)}")
                if (task.totalBytes > 0) append(" / ${formatBytes(task.totalBytes)}")
            }
            if (task.courseTitle.isNotBlank()) append(" • ${task.courseTitle}")
        }
        return NotificationCompat.Builder(this, PROGRESS_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(task.title)
            .setContentText("$status • $detail")
            .setStyle(NotificationCompat.BigTextStyle().bigText("$status • $detail"))
            .setProgress(100, progress, task.totalBytes <= 0)
            .setOngoing(task.state in setOf("queued", "yt_resolving", "yt_downloading"))
            .setOnlyAlertOnce(true)
            .setAutoCancel(task.state in setOf("paused", "failed"))
            .setContentIntent(openDownloads)
            .build()
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

    private fun cleanupExceptMp4(dir: File) {
        dir.listFiles()?.forEach { if (it.name != MP4_NAME) it.deleteRecursively() }
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024 * 1024 -> "%.1f GB".format(bytes.toDouble() / (1024L * 1024 * 1024))
        bytes >= 1024L * 1024 -> "%.1f MB".format(bytes.toDouble() / (1024L * 1024))
        else -> "${bytes / 1024} KB"
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val KIND = "youtube"
        private const val EXTRA_ID = "download_id"
        private const val MP4_NAME = "video.mp4"
        private const val STREAM_BUFFER_BYTES = 32 * 1024
        private const val UI_UPDATE_MS = 500L
        private const val PROGRESS_CHANNEL_ID = "video_downloads"
        private const val COMPLETE_CHANNEL_ID = "video_download_complete"

        fun start(context: Context, id: String) = ContextCompat.startForegroundService(
            context,
            Intent(context, YoutubeDownloadService::class.java).putExtra(EXTRA_ID, id),
        )

        fun resume(context: Context) {
            val hasWork = DownloadStore(context).all().any {
                it.kind == KIND && it.state in setOf("queued", "yt_resolving", "yt_downloading")
            }
            if (!hasWork) return
            ContextCompat.startForegroundService(context, Intent(context, YoutubeDownloadService::class.java))
        }

        private fun notificationId(id: String) = HlsDownloadService.notificationId(id)
    }

    private fun notificationId(id: String) = Companion.notificationId(id)
}
