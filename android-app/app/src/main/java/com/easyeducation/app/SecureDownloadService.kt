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
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SecureDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private lateinit var store: SecureMediaStore

    override fun onCreate() {
        super.onCreate()
        store = SecureMediaStore(this)
        createChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_ID)
        val tasks = if (id.isNullOrBlank()) store.pending() else listOfNotNull(store.get(id))
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

    private fun download(initial: SecureDownloadTask) {
        var task = initial.copy(state = "downloading", error = null)
        store.save(task)
        updateNotification(task)
        try {
            require(FirebaseAuth.getInstance().currentUser?.uid == task.userId) {
                "Sign in with the account that owns this download"
            }
            val source = resolveProgressiveSource(task)
            if (task.totalBytes > 0 && task.totalBytes != source.totalBytes) {
                store.resetChunks(task.id)
                task = task.copy(downloadedBytes = 0, chunkCount = 0)
            }
            task = task.copy(totalBytes = source.totalBytes)
            store.save(task)

            var downloaded = task.downloadedBytes.coerceIn(0, source.totalBytes)
            var chunkIndex = task.chunkCount
            val expectedIndex = (downloaded / SecureMediaStore.CHUNK_BYTES).toInt()
            if (downloaded % SecureMediaStore.CHUNK_BYTES != 0L || chunkIndex != expectedIndex) {
                store.resetChunks(task.id)
                downloaded = 0
                chunkIndex = 0
                task = task.copy(downloadedBytes = 0, chunkCount = 0)
                store.save(task)
            }

            while (downloaded < source.totalBytes) {
                val current = store.get(task.id) ?: throw DownloadStopped()
                if (current.state == "paused") throw DownloadPaused()
                val end = minOf(source.totalBytes - 1, downloaded + SecureMediaStore.CHUNK_BYTES - 1L)
                val bytes = source.fetch(downloaded, end)
                val expected = (end - downloaded + 1L).toInt()
                require(bytes.size == expected) { "Download chunk was incomplete (${bytes.size}/$expected)" }
                store.writeEncryptedChunk(task, chunkIndex, bytes)
                downloaded = end + 1
                chunkIndex += 1
                task = task.copy(
                    downloadedBytes = downloaded,
                    chunkCount = chunkIndex,
                    totalBytes = source.totalBytes,
                    state = "downloading",
                    error = null,
                )
                store.save(task)
                updateNotification(task)
            }

            task = task.copy(
                downloadedBytes = source.totalBytes,
                totalBytes = source.totalBytes,
                chunkCount = chunkIndex,
                state = "completed",
                error = null,
            )
            store.save(task)
            updateNotification(task, done = true)
            sendBroadcast(Intent(ACTION_DOWNLOAD_CHANGED).putExtra(EXTRA_ID, task.id))
        } catch (_: DownloadPaused) {
            task = task.copy(state = "paused", error = null)
            store.save(task)
            updateNotification(task)
            sendBroadcast(Intent(ACTION_DOWNLOAD_CHANGED).putExtra(EXTRA_ID, task.id))
        } catch (_: DownloadStopped) {
            // Removed while downloading.
        } catch (error: Throwable) {
            task = task.copy(state = "failed", error = error.message ?: "Download failed")
            store.save(task)
            updateNotification(task)
            sendBroadcast(Intent(ACTION_DOWNLOAD_CHANGED).putExtra(EXTRA_ID, task.id))
        }
    }

    private data class ProgressiveSource(
        val totalBytes: Long,
        val fetch: (Long, Long) -> ByteArray,
    )

    private fun resolveProgressiveSource(task: SecureDownloadTask): ProgressiveSource {
        val url = task.sourceUrl.trim()
        require(url.startsWith("https://")) { "Only secure HTTPS video sources can be downloaded" }
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(url) -> {
                val (_, format) = YoutubeDeviceResolver(http).pickFormat(url, task.height)
                val total = format.contentLength.takeIf { it > 0 } ?: probeLength(format.url)
                require(total > 0) { "YouTube video size is unavailable" }
                ProgressiveSource(total) { start, end -> fetchRange(format.url, start, end) }
            }
            isRumblePage(url) -> resolveRumble(task, url)
            url.contains(".m3u8", ignoreCase = true) -> {
                error("This class uses HLS-only media. Save a progressive MP4 source for secure offline download.")
            }
            else -> {
                val total = probeLength(url)
                require(total > 0) { "Video size is unavailable for this source" }
                ProgressiveSource(total) { start, end -> fetchRange(url, start, end) }
            }
        }
    }

    private fun resolveRumble(task: SecureDownloadTask, sourceUrl: String): ProgressiveSource {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val optionsUrl = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${android.net.Uri.encode(task.classId)}" +
            "&videoUrl=${android.net.Uri.encode(sourceUrl)}"
        val request = Request.Builder()
            .url(optionsUrl)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .build()
        val payload = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Offline video authorization failed (${response.code})")
            JSONObject(response.body?.string().orEmpty())
        }
        val signedToken = payload.optString("downloadToken")
        require(signedToken.isNotBlank()) { "Offline download token was not returned" }
        val options = payload.optJSONArray("options") ?: error("No offline qualities are available")
        val candidates = buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: continue
                if (item.optString("kind", "mp4") != "mp4") continue
                val height = item.optInt("height", 0)
                val size = item.optLong("contentLength", 0)
                if (height > 0 && size > 0) add(height to size)
            }
        }
        val selected = candidates.filter { it.first <= task.height }.maxByOrNull { it.first }
            ?: candidates.minByOrNull { it.first }
            ?: error("No progressive Rumble MP4 quality is available")
        val selectedHeight = selected.first
        val total = selected.second
        return ProgressiveSource(total) { start, end ->
            val chunkUrl = APP_ORIGIN + "/api/offline-video" +
                "?classId=${android.net.Uri.encode(task.classId)}" +
                "&height=$selectedHeight" +
                "&start=$start&end=$end" +
                "&downloadToken=${android.net.Uri.encode(signedToken)}"
            http.newCall(Request.Builder().url(chunkUrl).build()).execute().use { response ->
                if (!response.isSuccessful) error("Offline video chunk failed (${response.code})")
                response.body?.bytes() ?: error("Offline video chunk was empty")
            }
        }
    }

    private fun probeLength(url: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", USER_AGENT)
            .build()
        return http.newCall(request).execute().use { response ->
            val range = response.header("Content-Range").orEmpty()
            val fromRange = range.substringAfterLast('/', "").toLongOrNull()
            fromRange ?: response.header("Content-Length")?.toLongOrNull() ?: 0L
        }
    }

    private fun fetchRange(url: String, start: Long, end: Long): ByteArray {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=$start-$end")
            .header("User-Agent", USER_AGENT)
            .build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Video server returned HTTP ${response.code}")
            response.body?.bytes() ?: error("Video server returned an empty chunk")
        }
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Offline classes", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun notification(task: SecureDownloadTask, done: Boolean = false): Notification {
        val open = PendingIntent.getActivity(
            this,
            notificationId(task.id),
            Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_PATH, "/downloads"),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = when (task.state) {
            "completed" -> "Ready offline • ${task.height}p"
            "paused" -> "Paused • ${task.progress}%"
            "failed" -> task.error ?: "Download failed"
            else -> "${task.progress}% • encrypted offline copy"
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_easy_education)
            .setContentTitle(task.title)
            .setContentText(text)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(!done && task.state == "downloading")
            .setProgress(100, task.progress, task.totalBytes <= 0)
            .build()
    }

    private fun updateNotification(task: SecureDownloadTask, done: Boolean = false) {
        getSystemService(NotificationManager::class.java)
            .notify(notificationId(task.id), notification(task, done))
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private class DownloadPaused : Exception()
    private class DownloadStopped : Exception()

    companion object {
        const val EXTRA_ID = "secure_download_id"
        const val ACTION_DOWNLOAD_CHANGED = "com.easyeducation.app.SECURE_DOWNLOAD_CHANGED"
        private const val CHANNEL_ID = "secure_offline_classes_v2"
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        private const val USER_AGENT = "EasyEducationAndroid/2.0"

        fun start(context: Context, task: SecureDownloadTask) {
            SecureMediaStore(context).save(task.copy(state = "queued", error = null))
            ContextCompat.startForegroundService(
                context,
                Intent(context, SecureDownloadService::class.java).putExtra(EXTRA_ID, task.id),
            )
        }

        fun pause(context: Context, id: String) {
            val store = SecureMediaStore(context)
            store.get(id)?.let { store.save(it.copy(state = "paused")) }
        }

        fun resume(context: Context, id: String) {
            val store = SecureMediaStore(context)
            val task = store.get(id) ?: return
            store.save(task.copy(state = "queued", error = null))
            ContextCompat.startForegroundService(
                context,
                Intent(context, SecureDownloadService::class.java).putExtra(EXTRA_ID, id),
            )
        }

        fun resumePending(context: Context) {
            if (SecureMediaStore(context).pending().isEmpty()) return
            ContextCompat.startForegroundService(context, Intent(context, SecureDownloadService::class.java))
        }

        fun remove(context: Context, id: String) {
            pause(context, id)
            SecureMediaStore(context).remove(id)
            context.getSystemService(NotificationManager::class.java).cancel(notificationId(id))
            context.sendBroadcast(Intent(ACTION_DOWNLOAD_CHANGED).putExtra(EXTRA_ID, id))
        }

        private fun notificationId(id: String): Int = SecureMediaStore.safe(id).hashCode()
    }
}
