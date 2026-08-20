package com.easyeducation.app

import android.app.Service
import android.content.Intent
import android.os.IBinder
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
    private lateinit var notifier: DownloadNotifier

    override fun onCreate() {
        super.onCreate()
        store = SecureMediaStore(this)
        notifier = DownloadNotifier(this)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_ID).orEmpty()
        val generation = intent?.getLongExtra(EXTRA_GENERATION, -1L) ?: -1L
        val task = id.takeIf { it.isNotBlank() }?.let(store::get)
        if (task == null || (generation >= 0 && task.generation != generation)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        startForeground(notifier.activeNotificationId(task.id), notifier.progressNotification(task))
        executor.execute {
            download(task)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun download(initial: SecureDownloadTask) {
        val generation = initial.generation
        var task = initial
        try {
            ensureRunning(task.id, generation)
            require(FirebaseAuth.getInstance().currentUser?.uid == task.userId) {
                "Sign in with the account that owns this download"
            }
            NativeAccountSecurity.restrictionMessage(this, task.userId)?.let { error(it) }
            DownloadStoragePolicy.checkTask(this, task).let { check ->
                require(check.allowed) { check.message ?: "Not enough storage for this download" }
            }

            task = task.copy(state = "downloading", phase = "preparing", phaseProgress = 0, error = null)
            saveIfCurrent(task, generation)
            notifier.updateProgress(task)

            val source = resolveProgressiveSource(task)
            ensureRunning(task.id, generation)
            if (task.totalBytes > 0 && task.totalBytes != source.totalBytes) {
                store.resetChunks(task.id)
                task = task.copy(downloadedBytes = 0, chunkCount = 0)
            }
            if (task.expectedBytes > 0 && !task.sizeEstimated) {
                val drift = kotlin.math.abs(task.expectedBytes - source.totalBytes)
                require(drift <= maxOf(2L * 1024L * 1024L, task.expectedBytes / 20L)) {
                    "The selected video quality changed. Please choose the quality again."
                }
            }
            task = task.copy(
                totalBytes = source.totalBytes,
                expectedBytes = source.totalBytes,
                sizeEstimated = false,
                height = source.height,
                qualityLabel = source.label,
                phase = "downloading",
                phaseProgress = 0,
            )
            saveIfCurrent(task, generation)

            var downloaded = task.downloadedBytes.coerceIn(0, source.totalBytes)
            var chunkIndex = task.chunkCount
            val expectedIndex = (downloaded / SecureMediaStore.CHUNK_BYTES).toInt()
            if (downloaded % SecureMediaStore.CHUNK_BYTES != 0L || chunkIndex != expectedIndex) {
                store.resetChunks(task.id)
                downloaded = 0
                chunkIndex = 0
                task = task.copy(downloadedBytes = 0, chunkCount = 0)
                saveIfCurrent(task, generation)
            }

            while (downloaded < source.totalBytes) {
                ensureRunning(task.id, generation)
                val end = minOf(source.totalBytes - 1, downloaded + SecureMediaStore.CHUNK_BYTES - 1L)
                val bytes = source.fetch(downloaded, end)
                ensureRunning(task.id, generation)
                val expected = (end - downloaded + 1L).toInt()
                require(bytes.size == expected) { "Download chunk was incomplete (${bytes.size}/$expected)" }
                store.writeEncryptedChunk(task, chunkIndex, bytes)
                ensureRunning(task.id, generation)
                downloaded = end + 1
                chunkIndex += 1
                task = task.copy(
                    downloadedBytes = downloaded,
                    chunkCount = chunkIndex,
                    totalBytes = source.totalBytes,
                    state = "downloading",
                    phase = "downloading",
                    phaseProgress = 0,
                    error = null,
                )
                saveIfCurrent(task, generation)
                notifier.updateProgress(task)
            }

            ensureRunning(task.id, generation)
            task = task.copy(
                downloadedBytes = source.totalBytes,
                totalBytes = source.totalBytes,
                chunkCount = chunkIndex,
                state = "completed",
                phase = "completed",
                phaseProgress = 100,
                error = null,
            )
            saveIfCurrent(task, generation)
            require(store.hasCompleteMedia(task)) { "Encrypted offline copy failed its integrity check" }
            notifier.completed(task)
        } catch (error: Throwable) {
            val current = store.get(initial.id) ?: return
            if (current.generation != generation) return
            when (current.state) {
                "paused" -> notifier.paused(current)
                "deleting" -> notifier.cancelAll(current.id)
                else -> {
                    val failed = current.copy(
                        state = "failed",
                        phase = "failed",
                        error = friendlyError(error),
                    )
                    store.save(failed)
                    notifier.failed(failed)
                }
            }
        }
    }

    private data class ProgressiveSource(
        val totalBytes: Long,
        val height: Int,
        val label: String,
        val fetch: (Long, Long) -> ByteArray,
    )

    private fun resolveProgressiveSource(task: SecureDownloadTask): ProgressiveSource {
        val url = task.sourceUrl.trim()
        require(url.startsWith("https://")) { "Only secure HTTPS video sources can be downloaded" }
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(url) -> {
                val result = YoutubeDeviceResolver(http).resolve(url)
                val format = result.formats.firstOrNull { it.height == task.height }
                    ?: error("${task.qualityLabel.ifBlank { "${task.height}p" }} is no longer available. Choose a quality again.")
                val total = format.contentLength.takeIf { it > 0 } ?: probeLength(task.id, format.url)
                require(total > 0) { "YouTube video size is unavailable" }
                ProgressiveSource(total, format.height, format.qualityLabel) { start, end ->
                    fetchRange(task.id, format.url, start, end)
                }
            }
            isRumblePage(url) -> resolveRumble(task, url)
            SecureDownloadCoordinator.isHlsSource(url) -> error("HLS media must use the secure HLS downloader")
            else -> {
                val total = probeLength(task.id, url)
                require(total > 0) { "This video server does not expose a resumable file size" }
                ProgressiveSource(total, task.height, task.qualityLabel.ifBlank { "Original quality" }) { start, end ->
                    fetchRange(task.id, url, start, end)
                }
            }
        }
    }

    private fun resolveRumble(task: SecureDownloadTask, sourceUrl: String): ProgressiveSource {
        val directStreams = runCatching {
            NativeRumbleDirectResolver(http).resolveAll(sourceUrl).filter { !it.hls }
        }.getOrNull().orEmpty()
        if (directStreams.isNotEmpty()) {
            val selected = directStreams.firstOrNull { it.height == task.height }
                ?: directStreams.filter { it.height in 1..task.height }.maxByOrNull { it.height }
                ?: directStreams.minByOrNull { it.height.takeIf { value -> value > 0 } ?: Int.MAX_VALUE }
            if (selected != null) {
                val total = selected.contentLength.takeIf { it > 0L }
                    ?: probeRumbleLength(task.id, selected.url, sourceUrl)
                if (total > 0L) {
                    val height = selected.height.takeIf { it > 0 } ?: task.height
                    return ProgressiveSource(total, height, if (height > 0) "${height}p" else task.qualityLabel) { start, end ->
                        fetchRumbleRange(task.id, selected.url, sourceUrl, start, end)
                    }
                }
            }
        }

        return resolveRumbleServer(task, sourceUrl)
    }

    private fun resolveRumbleServer(task: SecureDownloadTask, sourceUrl: String): ProgressiveSource {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val optionsUrl = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${android.net.Uri.encode(task.classId)}" +
            "&videoUrl=${android.net.Uri.encode(sourceUrl)}"
        val payload = executeJson(task.id, Request.Builder()
            .url(optionsUrl)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .build())
        val signedToken = payload.optString("downloadToken")
        require(signedToken.isNotBlank()) { "Offline download authorization expired. Retry the download." }
        val options = payload.optJSONArray("options") ?: error("No offline qualities are available")
        var selectedHeight = -1
        var total = 0L
        for (index in 0 until options.length()) {
            val item = options.optJSONObject(index) ?: continue
            if (item.optString("kind", "mp4") != "mp4") continue
            if (item.optInt("height", 0) != task.height) continue
            selectedHeight = task.height
            total = item.optLong("contentLength", 0)
            break
        }
        require(selectedHeight > 0 && total > 0) {
            "${task.qualityLabel.ifBlank { "${task.height}p" }} is no longer available. Choose a quality again."
        }
        return ProgressiveSource(total, selectedHeight, "${selectedHeight}p") { start, end ->
            val chunkUrl = APP_ORIGIN + "/api/offline-video" +
                "?classId=${android.net.Uri.encode(task.classId)}" +
                "&height=$selectedHeight" +
                "&start=$start&end=$end" +
                "&downloadToken=${android.net.Uri.encode(signedToken)}"
            DownloadRuntime.execute(task.id, http.newCall(Request.Builder().url(chunkUrl).build())) { response ->
                if (response.code != 206) error("Offline video server did not return a byte range (${response.code})")
                response.body?.bytes() ?: error("Offline video chunk was empty")
            }
        }
    }

    private fun probeLength(downloadId: String, url: String): Long {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("User-Agent", USER_AGENT)
            .build()
        return DownloadRuntime.execute(downloadId, http.newCall(request)) { response ->
            if (response.code != 206) return@execute 0L
            val range = response.header("Content-Range").orEmpty()
            range.substringAfterLast('/', "").toLongOrNull() ?: 0L
        }
    }

    private fun probeRumbleLength(downloadId: String, url: String, sourceUrl: String): Long {
        val request = rumbleRequest(url, sourceUrl)
            .header("Range", "bytes=0-0")
            .build()
        return DownloadRuntime.execute(downloadId, http.newCall(request)) { response ->
            val range = response.header("Content-Range").orEmpty()
            range.substringAfterLast('/', "").toLongOrNull()
                ?: if (response.code == 200) response.header("Content-Length")?.toLongOrNull() ?: 0L else 0L
        }
    }

    private fun fetchRange(downloadId: String, url: String, start: Long, end: Long): ByteArray {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=$start-$end")
            .header("User-Agent", USER_AGENT)
            .build()
        return fetchCheckedRange(downloadId, request, start, end)
    }

    private fun fetchRumbleRange(
        downloadId: String,
        url: String,
        sourceUrl: String,
        start: Long,
        end: Long,
    ): ByteArray {
        val request = rumbleRequest(url, sourceUrl)
            .header("Range", "bytes=$start-$end")
            .build()
        return fetchCheckedRange(downloadId, request, start, end)
    }

    private fun fetchCheckedRange(downloadId: String, request: Request, start: Long, end: Long): ByteArray {
        return DownloadRuntime.execute(downloadId, http.newCall(request)) { response ->
            if (response.code != 206) error("Video server does not support safe resumable downloads (HTTP ${response.code})")
            val range = response.header("Content-Range").orEmpty()
            require(range.startsWith("bytes $start-$end/")) { "Video server returned the wrong byte range" }
            val expected = end - start + 1
            val declared = response.header("Content-Length")?.toLongOrNull()
            if (declared != null) require(declared == expected) { "Video server returned the wrong chunk size" }
            response.body?.bytes() ?: error("Video server returned an empty chunk")
        }
    }

    private fun rumbleRequest(url: String, sourceUrl: String): Request.Builder = Request.Builder()
        .url(url)
        .header("User-Agent", NativeRumbleDirectResolver.RUMBLE_USER_AGENT)
        .header("Referer", sourceUrl)
        .header("Origin", NativeRumbleDirectResolver.RUMBLE_ORIGIN)
        .header("Accept-Encoding", "identity")

    private fun executeJson(downloadId: String, request: Request): JSONObject =
        DownloadRuntime.execute(downloadId, http.newCall(request)) { response ->
            if (!response.isSuccessful) error("Offline video authorization failed (${response.code})")
            JSONObject(response.body?.string().orEmpty())
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

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    private fun friendlyError(error: Throwable): String = when {
        error is DownloadPaused -> "Paused"
        error is DownloadStopped -> "Download stopped"
        error.message?.contains("Canceled", ignoreCase = true) == true -> "Download paused"
        else -> error.message ?: "Download failed"
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private class DownloadPaused : Exception()
    private class DownloadStopped : Exception()

    companion object {
        const val EXTRA_ID = "secure_download_id"
        const val EXTRA_GENERATION = "secure_download_generation"
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        private const val USER_AGENT = "EasyEducationAndroid/2.10.9"
    }
}
