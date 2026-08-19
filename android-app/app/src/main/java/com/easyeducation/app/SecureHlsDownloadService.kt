package com.easyeducation.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
import java.lang.ref.WeakReference
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class SecureHlsDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var store: SecureMediaStore
    private lateinit var notifier: DownloadNotifier
    @Volatile private var activeTransformer: Transformer? = null
    @Volatile private var activeDownloadId: String? = null

    override fun onCreate() {
        super.onCreate()
        store = SecureMediaStore(this)
        notifier = DownloadNotifier(this)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(SecureDownloadService.EXTRA_ID).orEmpty()
        val generation = intent?.getLongExtra(SecureDownloadService.EXTRA_GENERATION, -1L) ?: -1L
        val task = id.takeIf { it.isNotBlank() }?.let(store::get)
        if (task == null || (generation >= 0 && task.generation != generation)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        startForeground(notifier.activeNotificationId(task.id), notifier.progressNotification(task))
        executor.execute {
            process(task)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun process(initial: SecureDownloadTask) {
        val generation = initial.generation
        var task = initial
        val workDir = tempDir(this, task.id).apply { mkdirs() }
        val tempMp4 = File(workDir, PLAIN_TEMP_NAME)
        try {
            ensureRunning(task.id, generation)
            require(com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid == task.userId) {
                "Sign in with the account that owns this download"
            }
            NativeAccountSecurity.restrictionMessage(this, task.userId)?.let { error(it) }
            DownloadStoragePolicy.checkTask(this, task).let { check ->
                require(check.allowed) { check.message ?: "Not enough storage for this offline video" }
            }

            task = task.copy(state = "downloading", phase = "preparing", phaseProgress = 1, error = null)
            saveIfCurrent(task, generation)
            notifier.updateProgress(task)

            val selected = resolveSelectedMediaPlaylist(task)
            val playlistUrl = selected.url
            val lines = selected.lines
            val mediaIndexes = lines.mapIndexedNotNull { index, line ->
                index.takeIf { line.isNotBlank() && !line.trimStart().startsWith("#") }
            }
            require(mediaIndexes.isNotEmpty()) { "HLS playlist contains no media segments" }
            val segmentUrls = mediaIndexes.map { URI(playlistUrl).resolve(lines[it].trim()).toString() }
            val segmentFiles = segmentUrls.mapIndexed { index, url ->
                File(workDir, "seg-%06d.%s".format(index, extension(url, "ts")))
            }

            var downloadedBytes = segmentFiles.filter { it.exists() && it.length() > 0 }.sumOf { it.length() }
            for (index in segmentUrls.indices) {
                ensureRunning(task.id, generation)
                val target = segmentFiles[index]
                if (!target.exists() || target.length() <= 0L) {
                    val part = File(workDir, target.name + ".part")
                    part.delete()
                    DownloadRuntime.execute(task.id, http.newCall(Request.Builder().url(segmentUrls[index]).build())) { response ->
                        check(response.isSuccessful) { "HLS segment ${index + 1} returned HTTP ${response.code}" }
                        val body = response.body ?: error("HLS segment ${index + 1} was empty")
                        body.byteStream().use { input ->
                            part.outputStream().use { output ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    ensureRunning(task.id, generation)
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    output.write(buffer, 0, count)
                                }
                            }
                        }
                    }
                    ensureRunning(task.id, generation)
                    check(part.length() > 0 && part.renameTo(target)) { "Could not save HLS segment ${index + 1}" }
                    downloadedBytes += target.length()
                }
                val stageProgress = (((index + 1) * 70.0) / segmentUrls.size).toInt().coerceIn(1, 70)
                task = task.copy(
                    state = "downloading",
                    phase = "downloading",
                    phaseProgress = stageProgress,
                    downloadedBytes = downloadedBytes,
                    totalBytes = task.expectedBytes.takeIf { it > 0 } ?: maxOf(downloadedBytes, 1L),
                    height = selected.height,
                    qualityLabel = selected.label,
                )
                saveIfCurrent(task, generation)
                notifier.updateProgress(task)
            }

            val localized = localizeAuxiliaryUris(task, generation, lines, playlistUrl, workDir)
            val finalLines = localized.mapIndexed { index, line ->
                val position = mediaIndexes.indexOf(index)
                if (position >= 0) segmentFiles[position].name else line
            }
            val localPlaylist = File(workDir, "offline.m3u8")
            localPlaylist.writeText(finalLines.joinToString("\n"))

            task = task.copy(state = "downloading", phase = "converting", phaseProgress = 72)
            saveIfCurrent(task, generation)
            notifier.updateProgress(task)

            tempMp4.delete()
            transformToMp4(task, generation, localPlaylist, tempMp4)
            ensureRunning(task.id, generation)
            require(tempMp4.exists() && tempMp4.length() > 0L) { "HLS conversion produced no video" }

            store.resetChunks(task.id)
            val finalBytes = tempMp4.length()
            var index = 0
            var encryptedBytes = 0L
            tempMp4.inputStream().use { input ->
                val buffer = ByteArray(SecureMediaStore.CHUNK_BYTES)
                while (true) {
                    ensureRunning(task.id, generation)
                    var count = 0
                    while (count < buffer.size) {
                        val read = input.read(buffer, count, buffer.size - count)
                        if (read < 0) break
                        count += read
                    }
                    if (count <= 0) break
                    val plain = if (count == buffer.size) buffer.copyOf() else buffer.copyOf(count)
                    store.writeEncryptedChunk(task, index, plain)
                    ensureRunning(task.id, generation)
                    index += 1
                    encryptedBytes += count
                    val encryptProgress = 75 + ((encryptedBytes * 24L) / finalBytes).toInt().coerceIn(0, 24)
                    task = task.copy(
                        state = "downloading",
                        phase = "encrypting",
                        phaseProgress = encryptProgress,
                        downloadedBytes = encryptedBytes,
                        totalBytes = finalBytes,
                        chunkCount = index,
                    )
                    saveIfCurrent(task, generation)
                    notifier.updateProgress(task)
                }
            }

            ensureRunning(task.id, generation)
            task = task.copy(
                state = "completed",
                phase = "completed",
                phaseProgress = 100,
                downloadedBytes = finalBytes,
                totalBytes = finalBytes,
                expectedBytes = finalBytes,
                sizeEstimated = false,
                chunkCount = index,
                error = null,
            )
            saveIfCurrent(task, generation)
            require(store.hasCompleteMedia(task)) { "Encrypted offline copy failed its integrity check" }
            workDir.deleteRecursively()
            notifier.completed(task)
        } catch (error: Throwable) {
            cancelTransformer()
            tempMp4.delete()
            val current = store.get(initial.id) ?: run {
                workDir.deleteRecursively()
                notifier.cancelAll(initial.id)
                return
            }
            if (current.generation != generation) return
            when (current.state) {
                "paused" -> notifier.paused(current)
                "deleting" -> {
                    workDir.deleteRecursively()
                    notifier.cancelAll(current.id)
                }
                else -> {
                    val failed = current.copy(state = "failed", phase = "failed", error = friendlyError(error))
                    store.save(failed)
                    notifier.failed(failed)
                }
            }
        } finally {
            activeInstances.remove(initial.id)
        }
    }

    private data class SelectedPlaylist(
        val url: String,
        val lines: List<String>,
        val height: Int,
        val label: String,
    )

    private fun resolveSelectedMediaPlaylist(task: SecureDownloadTask): SelectedPlaylist {
        val originalUrl = task.sourceUrl
        val originalLines = getText(task.id, originalUrl).lines()
        val master = originalLines.any { it.startsWith("#EXT-X-STREAM-INF:") }
        if (!master) {
            return SelectedPlaylist(
                originalUrl,
                originalLines,
                task.height,
                task.qualityLabel.ifBlank { "Source quality" },
            )
        }

        data class Variant(val height: Int, val url: String)
        val variants = mutableListOf<Variant>()
        originalLines.forEachIndexed { index, line ->
            if (!line.startsWith("#EXT-X-STREAM-INF:")) return@forEachIndexed
            val height = Regex("RESOLUTION=\\d+x(\\d+)", RegexOption.IGNORE_CASE)
                .find(line)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
            val next = originalLines.drop(index + 1)
                .firstOrNull { it.isNotBlank() && !it.trimStart().startsWith("#") }
                ?: return@forEachIndexed
            variants += Variant(height, URI(originalUrl).resolve(next.trim()).toString())
        }

        val selected = (
            if (task.height > 0) variants.firstOrNull { it.height == task.height }
            else variants.firstOrNull()
        ) ?: error("The selected HLS quality is no longer available. Choose a quality again.")

        val mediaLines = getText(task.id, selected.url).lines()
        return SelectedPlaylist(
            selected.url,
            mediaLines,
            selected.height,
            if (selected.height > 0) "${selected.height}p" else "Source quality",
        )
    }

    private fun localizeAuxiliaryUris(
        task: SecureDownloadTask,
        generation: Long,
        lines: List<String>,
        playlistUrl: String,
        dir: File,
    ): List<String> {
        val uriRegex = Regex("URI=\"([^\"]+)\"")
        return lines.map { line ->
            if (!line.startsWith("#EXT-X-MAP:") && !line.startsWith("#EXT-X-KEY:")) return@map line
            val match = uriRegex.find(line) ?: return@map line
            val raw = match.groupValues[1]
            if (raw.isBlank()) return@map line
            ensureRunning(task.id, generation)
            val source = URI(playlistUrl).resolve(raw).toString()
            val localName = "aux-${safe(source).take(16)}.${extension(source, "bin")}" 
            val target = File(dir, localName)
            if (!target.exists()) {
                val bytes = DownloadRuntime.execute(task.id, http.newCall(Request.Builder().url(source).build())) { response ->
                    check(response.isSuccessful) { "HLS auxiliary resource returned HTTP ${response.code}" }
                    response.body?.bytes() ?: error("HLS auxiliary resource was empty")
                }
                ensureRunning(task.id, generation)
                target.writeBytes(bytes)
            }
            line.replaceRange(match.range, "URI=\"$localName\"")
        }
    }

    @androidx.annotation.OptIn(UnstableApi::class)
    private fun transformToMp4(
        task: SecureDownloadTask,
        generation: Long,
        playlist: File,
        output: File,
    ) {
        val done = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>(null)
        activeDownloadId = task.id
        activeInstances[task.id] = WeakReference(this)
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
        while (!done.await(350, TimeUnit.MILLISECONDS)) ensureRunning(task.id, generation)
        failure.get()?.let { throw it }
    }

    private fun cancelTransformer() {
        val transformer = activeTransformer ?: return
        mainHandler.post {
            runCatching { transformer.cancel() }
            if (activeTransformer === transformer) activeTransformer = null
        }
    }

    private fun getText(downloadId: String, url: String): String =
        DownloadRuntime.execute(downloadId, http.newCall(Request.Builder().url(url).build())) { response ->
            check(response.isSuccessful) { "HLS playlist returned HTTP ${response.code}" }
            response.body?.string() ?: error("HLS playlist was empty")
        }

    private fun ensureRunning(id: String, generation: Long): SecureDownloadTask {
        val current = store.get(id) ?: throw DownloadStopped()
        if (current.generation != generation) throw DownloadStopped()
        if (current.state == "paused") throw DownloadPaused()
        if (current.state == "deleting") throw DownloadStopped()
        return current
    }

    private fun saveIfCurrent(task: SecureDownloadTask, generation: Long) {
        ensureRunning(task.id, generation)
        store.save(task)
    }

    private fun extension(url: String, fallback: String): String = runCatching {
        val ext = URI(url).path.substringAfterLast('.', "").lowercase()
        if (ext.matches(Regex("[a-z0-9]{1,5}"))) ext else fallback
    }.getOrDefault(fallback)

    private fun safe(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun friendlyError(error: Throwable): String = when {
        error is DownloadPaused -> "Paused"
        error is DownloadStopped -> "Download stopped"
        error.message?.contains("Canceled", ignoreCase = true) == true -> "Download paused"
        else -> error.message ?: "HLS download failed"
    }

    override fun onDestroy() {
        activeDownloadId?.let(activeInstances::remove)
        cancelTransformer()
        executor.shutdownNow()
        super.onDestroy()
    }

    private class DownloadPaused : Exception()
    private class DownloadStopped : Exception()

    companion object {
        private const val PLAIN_TEMP_NAME = "plain-working.mp4"
        private val activeInstances = ConcurrentHashMap<String, WeakReference<SecureHlsDownloadService>>()

        fun tempDir(context: Context, id: String): File =
            File(context.cacheDir, "secure_hls/${SecureMediaStore.safe(id)}")

        fun cancelActiveTransform(id: String) {
            activeInstances[id]?.get()?.cancelTransformer()
        }

        fun cancelNotification(context: Context, id: String) {
            DownloadNotifier(context).cancelAll(id)
        }

        fun cleanupPlaintext(context: Context) {
            val root = File(context.cacheDir, "secure_hls")
            root.listFiles()?.forEach { dir -> File(dir, PLAIN_TEMP_NAME).delete() }
        }
    }
}
