package com.easyeducation.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
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
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class SecureHlsDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().retryOnConnectionFailure(true).build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var store: SecureMediaStore
    @Volatile private var activeTransformer: Transformer? = null

    override fun onCreate() {
        super.onCreate()
        store = SecureMediaStore(this)
        createChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(SecureDownloadService.EXTRA_ID)
        val task = id?.let(store::get)
        if (task == null || !SecureDownloadCoordinator.isHlsSource(task.sourceUrl)) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(notificationId(task.id), notification(task))
        executor.execute {
            process(task)
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
        // Coordinator/BootReceiver explicitly resume pending jobs. Avoid a null-intent
        // sticky restart that could lose the job identity.
        return START_NOT_STICKY
    }

    private fun process(initial: SecureDownloadTask) {
        var task = initial.copy(state = "downloading", error = null)
        store.save(task)
        updateNotification(task)
        val workDir = tempDir(this, task.id).apply { mkdirs() }
        try {
            ensureAllowed(task)
            val playlistText = getText(task.sourceUrl)
            val lines = playlistText.lines()
            require(lines.firstOrNull()?.trim()?.startsWith("#EXTM3U") == true) { "Invalid HLS playlist" }

            if (isMasterPlaylist(lines)) {
                val variant = selectVariant(lines, task.sourceUrl, task.height)
                    ?: error("No playable HLS quality was found")
                task = task.copy(sourceUrl = variant)
                store.save(task)
                process(task)
                return
            }

            val mediaIndexes = lines.mapIndexedNotNull { index, line ->
                index.takeIf { line.isNotBlank() && !line.trimStart().startsWith("#") }
            }
            require(mediaIndexes.isNotEmpty()) { "HLS playlist contains no media segments" }
            val segmentUrls = mediaIndexes.map { URI(task.sourceUrl).resolve(lines[it].trim()).toString() }
            val segmentFiles = segmentUrls.mapIndexed { index, url ->
                File(workDir, "seg-%06d.%s".format(index, extension(url, "ts")))
            }

            segmentUrls.forEachIndexed { index, url ->
                ensureRunning(task.id)
                val target = segmentFiles[index]
                if (!target.exists() || target.length() <= 0L) {
                    val part = File(workDir, target.name + ".part")
                    part.delete()
                    http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                        check(response.isSuccessful) { "HLS segment ${index + 1} returned HTTP ${response.code}" }
                        val body = response.body ?: error("HLS segment ${index + 1} was empty")
                        body.byteStream().use { input ->
                            part.outputStream().use { output ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    ensureRunning(task.id)
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    output.write(buffer, 0, count)
                                }
                            }
                        }
                    }
                    check(part.renameTo(target)) { "Could not save HLS segment ${index + 1}" }
                }
                val percent = ((index + 1) * 70 / segmentUrls.size).coerceIn(0, 70)
                task = task.copy(state = "downloading", downloadedBytes = percent.toLong(), totalBytes = 100)
                store.save(task)
                updateNotification(task)
            }

            val localized = localizeAuxiliaryUris(lines, task.sourceUrl, workDir)
            val finalLines = localized.mapIndexed { index, line ->
                val position = mediaIndexes.indexOf(index)
                if (position >= 0) segmentFiles[position].name else line
            }
            val localPlaylist = File(workDir, "offline.m3u8")
            localPlaylist.writeText(finalLines.joinToString("\n"))

            task = task.copy(state = "downloading", downloadedBytes = 75, totalBytes = 100)
            store.save(task)
            updateNotification(task)

            val tempMp4 = File(workDir, "plain-working.mp4")
            if (tempMp4.exists()) tempMp4.delete()
            transformToMp4(task, localPlaylist, tempMp4)
            require(tempMp4.exists() && tempMp4.length() > 0L) { "HLS conversion produced no video" }

            store.resetChunks(task.id)
            val totalBytes = tempMp4.length()
            var index = 0
            var encryptedBytes = 0L
            tempMp4.inputStream().use { input ->
                val buffer = ByteArray(SecureMediaStore.CHUNK_BYTES)
                while (true) {
                    ensureRunning(task.id)
                    var count = 0
                    while (count < buffer.size) {
                        val read = input.read(buffer, count, buffer.size - count)
                        if (read < 0) break
                        count += read
                    }
                    if (count <= 0) break
                    val plain = if (count == buffer.size) buffer.copyOf() else buffer.copyOf(count)
                    store.writeEncryptedChunk(task, index, plain)
                    index += 1
                    encryptedBytes += count
                    task = task.copy(
                        state = "downloading",
                        downloadedBytes = encryptedBytes,
                        totalBytes = totalBytes,
                        chunkCount = index,
                    )
                    store.save(task)
                    updateNotification(task)
                }
            }

            ensureRunning(task.id)
            task = task.copy(
                state = "completed",
                downloadedBytes = totalBytes,
                totalBytes = totalBytes,
                chunkCount = index,
                error = null,
            )
            store.save(task)
            workDir.deleteRecursively()
            updateNotification(task, done = true)
            sendBroadcast(Intent(SecureDownloadService.ACTION_DOWNLOAD_CHANGED).putExtra(SecureDownloadService.EXTRA_ID, task.id))
        } catch (_: DownloadPaused) {
            cancelTransformer()
            task = store.get(task.id)?.copy(state = "paused", error = null) ?: return
            store.save(task)
            updateNotification(task)
        } catch (_: DownloadStopped) {
            cancelTransformer()
            workDir.deleteRecursively()
            cancelNotification(this, task.id)
        } catch (error: Throwable) {
            cancelTransformer()
            val existing = store.get(task.id) ?: return
            task = existing.copy(state = "failed", error = error.message ?: "HLS download failed")
            store.save(task)
            updateNotification(task)
        }
    }

    private fun ensureAllowed(task: SecureDownloadTask) {
        val uid = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid
        require(uid == task.userId) { "Sign in with the account that owns this download" }
        NativeAccountSecurity.restrictionMessage(this, task.userId)?.let { error(it) }
    }

    private fun ensureRunning(id: String) {
        val current = store.get(id) ?: throw DownloadStopped()
        if (current.state == "paused") throw DownloadPaused()
    }

    private fun getText(url: String): String = http.newCall(Request.Builder().url(url).build()).execute().use { response ->
        check(response.isSuccessful) { "HLS playlist returned HTTP ${response.code}" }
        response.body?.string() ?: error("HLS playlist was empty")
    }

    private fun isMasterPlaylist(lines: List<String>): Boolean = lines.any { it.startsWith("#EXT-X-STREAM-INF:") }

    private fun selectVariant(lines: List<String>, baseUrl: String, requestedHeight: Int): String? {
        data class Variant(val height: Int, val url: String)
        val variants = mutableListOf<Variant>()
        lines.forEachIndexed { index, line ->
            if (!line.startsWith("#EXT-X-STREAM-INF:")) return@forEachIndexed
            val resolution = Regex("RESOLUTION=\\d+x(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
            val next = lines.drop(index + 1).firstOrNull { it.isNotBlank() && !it.startsWith("#") } ?: return@forEachIndexed
            variants += Variant(resolution, URI(baseUrl).resolve(next.trim()).toString())
        }
        if (variants.isEmpty()) return null
        return variants.filter { it.height in 1..requestedHeight }.maxByOrNull { it.height }?.url
            ?: variants.filter { it.height > 0 }.minByOrNull { it.height }?.url
            ?: variants.first().url
    }

    private fun localizeAuxiliaryUris(lines: List<String>, playlistUrl: String, dir: File): List<String> {
        val uriRegex = Regex("URI=\"([^\"]+)\"")
        return lines.map { line ->
            if (!line.startsWith("#EXT-X-MAP:") && !line.startsWith("#EXT-X-KEY:")) return@map line
            val match = uriRegex.find(line) ?: return@map line
            val raw = match.groupValues[1]
            if (raw.isBlank()) return@map line
            val source = URI(playlistUrl).resolve(raw).toString()
            val localName = "aux-${safe(source).take(16)}.${extension(source, "bin")}" 
            val target = File(dir, localName)
            if (!target.exists()) {
                http.newCall(Request.Builder().url(source).build()).execute().use { response ->
                    check(response.isSuccessful) { "HLS auxiliary resource returned HTTP ${response.code}" }
                    target.writeBytes(response.body?.bytes() ?: error("HLS auxiliary resource was empty"))
                }
            }
            line.replaceRange(match.range, "URI=\"$localName\"")
        }
    }

    @androidx.annotation.OptIn(UnstableApi::class)
    private fun transformToMp4(task: SecureDownloadTask, playlist: File, output: File) {
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
                transformer.start(mediaItem, output.absolutePath)
            } catch (error: Throwable) {
                failure.set(error)
                activeTransformer = null
                done.countDown()
            }
        }
        while (!done.await(500, TimeUnit.MILLISECONDS)) ensureRunning(task.id)
        failure.get()?.let { throw it }
    }

    private fun cancelTransformer() {
        val transformer = activeTransformer ?: return
        mainHandler.post {
            runCatching { transformer.cancel() }
            if (activeTransformer === transformer) activeTransformer = null
        }
    }

    private fun extension(url: String, fallback: String): String = runCatching {
        val ext = URI(url).path.substringAfterLast('.', "").lowercase()
        if (ext.matches(Regex("[a-z0-9]{1,5}"))) ext else fallback
    }.getOrDefault(fallback)

    private fun safe(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Offline classes", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun notification(task: SecureDownloadTask, done: Boolean = false): Notification {
        val open = PendingIntent.getActivity(
            this,
            notificationId(task.id),
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_PATH, "/downloads")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val progress = task.progress
        val text = when (task.state) {
            "completed" -> "Ready offline • ${task.height}p"
            "paused" -> "Paused"
            "failed" -> task.error ?: "Download failed"
            else -> "Preparing encrypted offline class • $progress%"
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_easy_education)
            .setContentTitle(task.title)
            .setContentText(text)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(!done && task.state == "downloading")
            .setProgress(100, progress, false)
            .build()
    }

    private fun updateNotification(task: SecureDownloadTask, done: Boolean = false) {
        getSystemService(NotificationManager::class.java)
            .notify(notificationId(task.id), notification(task, done))
    }

    override fun onDestroy() {
        cancelTransformer()
        executor.shutdownNow()
        super.onDestroy()
    }

    private class DownloadPaused : Exception()
    private class DownloadStopped : Exception()

    companion object {
        private const val CHANNEL_ID = "secure_offline_classes_hls_v2"

        fun tempDir(context: Context, id: String): File =
            File(context.cacheDir, "secure_hls/${SecureMediaStore.safe(id)}")

        fun cancelNotification(context: Context, id: String) {
            context.getSystemService(NotificationManager::class.java).cancel(notificationId(id))
        }

        private fun notificationId(id: String): Int = ("hls:" + SecureMediaStore.safe(id)).hashCode()
    }
}
