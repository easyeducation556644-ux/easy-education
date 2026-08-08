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

class HlsDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
    private lateinit var store: DownloadStore

    override fun onCreate() { super.onCreate(); store = DownloadStore(this); createChannel() }
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_ID)
        val tasks = if (id != null) listOfNotNull(store.get(id)) else store.pending()
        if (tasks.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        startForeground(NOTIFICATION_ID, notification(tasks.first(), 0))
        executor.execute {
            tasks.forEach { download(it) }
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_STICKY
    }

    private fun download(initial: DownloadTask) {
        var task = initial.copy(state = "downloading", error = null)
        store.save(task)
        try {
            val playlist = get(initial.playlistUrl).decodeToString()
            val lines = playlist.lines()
            val urls = lines.filter { it.isNotBlank() && !it.startsWith("#") }
                .map { URI(initial.playlistUrl).resolve(it).toString() }
            require(urls.isNotEmpty()) { "Playlist has no media segments" }
            val dir = File(filesDir, "offline/${safe(initial.id)}").apply { mkdirs() }
            val start = (0 until urls.size).firstOrNull { !File(dir, "segment-%06d.ts".format(it)).exists() } ?: urls.size
            for (index in start until urls.size) {
                val target = File(dir, "segment-%06d.ts".format(index))
                val temp = File(dir, target.name + ".part")
                temp.outputStream().use { it.write(get(urls[index])) }
                check(temp.renameTo(target)) { "Could not save segment ${index + 1}" }
                task = task.copy(completed = index + 1, total = urls.size)
                store.save(task)
                if (index == start || index % 5 == 0) notify(task)
            }
            val local = lines.map { line ->
                if (line.isBlank() || line.startsWith("#")) line
                else "segment-%06d.ts".format(urls.indices.takeWhile { true }.size)
            }
            var segment = 0
            val rewritten = lines.joinToString("\n") { line ->
                if (line.isBlank() || line.startsWith("#")) line else "segment-%06d.ts".format(segment++)
            }
            File(dir, "playlist.m3u8").writeText(rewritten)
            task = task.copy(completed = urls.size, total = urls.size, state = "completed")
            store.save(task); notify(task)
        } catch (error: Throwable) {
            store.save(task.copy(state = "failed", error = error.message ?: "Download failed"))
            notify(task.copy(state = "failed"))
        }
    }

    private fun get(url: String): ByteArray {
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code}" }
            return response.body?.bytes() ?: error("Empty response")
        }
    }

    private fun notify(task: DownloadTask) {
        val progress = if (task.total > 0) task.completed * 100 / task.total else 0
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(task, progress))
    }

    private fun notification(task: DownloadTask, progress: Int): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(task.title)
            .setContentText(if (task.state == "completed") "Download complete" else "$progress% downloaded")
            .setProgress(100, progress, task.total == 0)
            .setOngoing(task.state == "downloading").setContentIntent(open).build()
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Video downloads", NotificationManager.IMPORTANCE_LOW))
    }

    companion object {
        private const val CHANNEL_ID = "video_downloads"
        private const val NOTIFICATION_ID = 4102
        private const val EXTRA_ID = "download_id"
        fun start(context: Context, id: String) = ContextCompat.startForegroundService(context,
            Intent(context, HlsDownloadService::class.java).putExtra(EXTRA_ID, id))
        fun resume(context: Context) {
            if (DownloadStore(context).pending().isEmpty()) return
            ContextCompat.startForegroundService(context, Intent(context, HlsDownloadService::class.java))
        }
        fun safe(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)
    }
}
