package com.easyeducation.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import android.net.Uri
import android.os.IBinder
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Downloads real YouTube qualities. Low qualities may be progressive A/V files; HD/UHD
 * qualities are normally adaptive video-only + audio-only streams and are losslessly
 * muxed inside app-private cache storage before the final file is encrypted.
 */
class SecureYoutubeDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
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
        val id = intent?.getStringExtra(SecureDownloadService.EXTRA_ID).orEmpty()
        val generation = intent?.getLongExtra(SecureDownloadService.EXTRA_GENERATION, -1L) ?: -1L
        val task = id.takeIf { it.isNotBlank() }?.let(store::get)
        if (task == null || (generation >= 0L && task.generation != generation)) {
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
        val dir = tempDir(this, initial.id).apply { mkdirs() }
        val progressiveFile = File(dir, PROGRESSIVE_PART)
        val videoFile = File(dir, VIDEO_PART)
        val audioFile = File(dir, AUDIO_PART)
        val muxedFile = File(dir, MUXED_FILE)
        val muxedWebm = File(dir, MUXED_WEBM)

        try {
            ensureRunning(task.id, generation)
            require(FirebaseAuth.getInstance().currentUser?.uid == task.userId) {
                "Sign in with the account that owns this download"
            }
            NativeAccountSecurity.restrictionMessage(this, task.userId)?.let { error(it) }
            DownloadStoragePolicy.checkTask(this, task).let { check ->
                require(check.allowed) { check.message ?: "Not enough storage for this YouTube quality" }
            }

            task = task.copy(state = "downloading", phase = "preparing", phaseProgress = 1, error = null)
            saveIfCurrent(task, generation)
            notifier.updateProgress(task)

            val (_, variant) = YoutubeDeviceResolver(http).pickVariant(task.sourceUrl, task.height)
            val transferBytes = variant.transferBytes
            require(transferBytes > 0L) { "YouTube did not report a safe resumable size for this quality" }
            if (task.expectedBytes > 0L && !task.sizeEstimated) {
                val drift = kotlin.math.abs(task.expectedBytes - transferBytes)
                require(drift <= maxOf(3L * 1024L * 1024L, task.expectedBytes / 20L)) {
                    "The selected YouTube quality changed. Please choose the quality again."
                }
            }

            val finalPlaintext: File
            if (variant.progressive != null) {
                videoFile.delete()
                audioFile.delete()
                muxedFile.delete()
                muxedWebm.delete()
                task = downloadStream(
                    task = task,
                    generation = generation,
                    format = variant.progressive,
                    target = progressiveFile,
                    alreadyTransferred = 0L,
                    totalTransfer = transferBytes,
                    stageStart = 2,
                    stageEnd = 84,
                )
                finalPlaintext = progressiveFile
            } else {
                progressiveFile.delete()
                val video = variant.video ?: error("Selected YouTube video stream is unavailable")
                val audio = variant.audio ?: error("Selected YouTube audio stream is unavailable")
                val videoDone = videoFile.length().coerceAtMost(video.contentLength)
                task = downloadStream(
                    task = task,
                    generation = generation,
                    format = video,
                    target = videoFile,
                    alreadyTransferred = 0L,
                    totalTransfer = transferBytes,
                    stageStart = 2,
                    stageEnd = 62,
                )
                task = downloadStream(
                    task = task,
                    generation = generation,
                    format = audio,
                    target = audioFile,
                    alreadyTransferred = video.contentLength.coerceAtLeast(videoDone),
                    totalTransfer = transferBytes,
                    stageStart = 62,
                    stageEnd = 80,
                )

                ensureRunning(task.id, generation)
                task = task.copy(
                    phase = "merging",
                    phaseProgress = 82,
                    downloadedBytes = transferBytes,
                    totalBytes = transferBytes,
                    qualityLabel = variant.qualityLabel,
                )
                saveIfCurrent(task, generation)
                notifier.updateProgress(task)

                val output = if (variant.container == "webm") muxedWebm else muxedFile
                output.delete()
                muxAdaptive(videoFile, audioFile, output, variant.container)
                ensureRunning(task.id, generation)
                require(output.exists() && output.length() > 0L) { "YouTube audio/video merge produced no media" }
                finalPlaintext = output
            }

            ensureRunning(task.id, generation)
            require(finalPlaintext.exists() && finalPlaintext.length() > 0L) { "Downloaded YouTube media is empty" }
            val finalBytes = finalPlaintext.length()
            store.resetChunks(task.id)
            var chunkIndex = 0
            var encryptedBytes = 0L
            finalPlaintext.inputStream().use { input ->
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
                    store.writeEncryptedChunk(task, chunkIndex, plain)
                    ensureRunning(task.id, generation)
                    chunkIndex += 1
                    encryptedBytes += count
                    val encryptProgress = 86 + ((encryptedBytes * 13L) / finalBytes).toInt().coerceIn(0, 13)
                    task = task.copy(
                        state = "downloading",
                        phase = "encrypting",
                        phaseProgress = encryptProgress,
                        downloadedBytes = encryptedBytes,
                        totalBytes = finalBytes,
                        chunkCount = chunkIndex,
                        height = variant.height,
                        qualityLabel = variant.qualityLabel,
                        error = null,
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
                chunkCount = chunkIndex,
                height = variant.height,
                qualityLabel = variant.qualityLabel,
                error = null,
            )
            saveIfCurrent(task, generation)
            require(store.hasCompleteMedia(task)) { "Encrypted offline copy failed its integrity check" }
            dir.deleteRecursively()
            notifier.completed(task)
        } catch (error: Throwable) {
            // A partially muxed output is never useful for resume; source parts are resumable.
            muxedFile.delete()
            muxedWebm.delete()
            val current = store.get(initial.id) ?: run {
                dir.deleteRecursively()
                notifier.cancelAll(initial.id)
                return
            }
            if (current.generation != generation) return
            when (current.state) {
                "paused" -> notifier.paused(current)
                "deleting" -> {
                    dir.deleteRecursively()
                    notifier.cancelAll(current.id)
                }
                else -> {
                    val failed = current.copy(state = "failed", phase = "failed", error = friendlyError(error))
                    store.save(failed)
                    notifier.failed(failed)
                }
            }
        }
    }

    /**
     * GoogleVideo adaptive URLs are short-lived and some CDN nodes reject an unbounded
     * `Range: bytes=N-` request even though a small probe succeeds. Download in bounded
     * chunks and transparently re-resolve the selected quality on 403/410 so long HD/UHD
     * downloads can continue without throwing away already downloaded bytes.
     */
    private fun downloadStream(
        task: SecureDownloadTask,
        generation: Long,
        format: YoutubeDeviceResolver.Format,
        target: File,
        alreadyTransferred: Long,
        totalTransfer: Long,
        stageStart: Int,
        stageEnd: Int,
    ): SecureDownloadTask {
        var activeFormat = format
        require(activeFormat.contentLength > 0L) { "YouTube stream size is unavailable" }
        if (target.length() > activeFormat.contentLength) target.delete()
        var offset = target.length()
        var current = task
        var refreshAttempts = 0

        while (offset < activeFormat.contentLength) {
            ensureRunning(task.id, generation)
            val start = offset
            val end = minOf(
                activeFormat.contentLength - 1L,
                start + YOUTUBE_RANGE_BYTES - 1L,
            )
            val request = Request.Builder()
                .url(activeFormat.url)
                .header("Range", "bytes=$start-$end")
                .header("User-Agent", streamUserAgent(activeFormat.url))
                .header("Accept-Encoding", "identity")
                .header("Accept-Language", "en-US,en;q=0.9")
                .get()
                .build()

            try {
                DownloadRuntime.execute(task.id, http.newCall(request)) { response ->
                    if (response.code == 403 || response.code == 410) {
                        throw RefreshableYoutubeUrl(response.code)
                    }
                    if (response.code != 206) {
                        error("YouTube stream returned HTTP ${response.code}. Retry to refresh the media URL.")
                    }

                    val contentRange = response.header("Content-Range").orEmpty()
                    require(contentRange.startsWith("bytes $start-$end/")) {
                        "YouTube returned the wrong byte range"
                    }
                    val expected = end - start + 1L
                    response.header("Content-Length")?.toLongOrNull()?.let { declared ->
                        require(declared == expected) {
                            "YouTube returned the wrong chunk size"
                        }
                    }

                    val body = response.body ?: error("YouTube stream response was empty")
                    var written = 0L
                    FileOutputStream(target, true).use { output ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(STREAM_BUFFER_BYTES)
                            while (written < expected) {
                                ensureRunning(task.id, generation)
                                val allowed = minOf(buffer.size.toLong(), expected - written).toInt()
                                val count = input.read(buffer, 0, allowed)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                                written += count

                                val absoluteOffset = start + written
                                val transferred = (alreadyTransferred + absoluteOffset).coerceAtMost(totalTransfer)
                                val fraction = if (totalTransfer > 0L) {
                                    transferred.toDouble() / totalTransfer.toDouble()
                                } else 0.0
                                val stage = (stageStart + ((stageEnd - stageStart) * fraction))
                                    .toInt()
                                    .coerceIn(stageStart, stageEnd)
                                current = current.copy(
                                    state = "downloading",
                                    phase = "downloading",
                                    phaseProgress = stage,
                                    downloadedBytes = transferred,
                                    totalBytes = totalTransfer,
                                    error = null,
                                )
                                saveIfCurrent(current, generation)
                                notifier.updateProgress(current)
                            }
                            output.flush()
                            output.fd.sync()
                        }
                    }
                    require(written == expected) {
                        "YouTube stream chunk was incomplete ($written/$expected bytes)"
                    }
                }
                offset = target.length()
                refreshAttempts = 0
            } catch (refresh: RefreshableYoutubeUrl) {
                if (refreshAttempts >= MAX_MEDIA_URL_REFRESHES) {
                    error("YouTube media URL was rejected repeatedly (HTTP ${refresh.code}). Retry the download.")
                }
                refreshAttempts += 1
                val refreshed = refreshFormat(task, activeFormat)
                if (
                    refreshed.itag != activeFormat.itag ||
                    refreshed.contentLength != activeFormat.contentLength
                ) {
                    // Never concatenate bytes from two different YouTube itags/files.
                    target.delete()
                    offset = 0L
                    current = current.copy(
                        downloadedBytes = alreadyTransferred,
                        phaseProgress = stageStart,
                    )
                    saveIfCurrent(current, generation)
                }
                activeFormat = refreshed
            }
        }

        ensureRunning(task.id, generation)
        require(target.length() == activeFormat.contentLength) {
            "YouTube stream was incomplete (${target.length()}/${activeFormat.contentLength} bytes)"
        }
        return current
    }

    private fun refreshFormat(
        task: SecureDownloadTask,
        previous: YoutubeDeviceResolver.Format,
    ): YoutubeDeviceResolver.Format {
        val (_, refreshedVariant) = YoutubeDeviceResolver(http).pickVariant(task.sourceUrl, task.height)
        val refreshed = when {
            previous.hasVideo && previous.hasAudio -> refreshedVariant.progressive
            previous.hasVideo -> refreshedVariant.video
            previous.hasAudio -> refreshedVariant.audio
            else -> null
        } ?: error("The selected YouTube quality is no longer available. Choose a quality again.")
        require(refreshed.contentLength > 0L) { "YouTube refreshed stream size is unavailable" }
        return refreshed
    }

    private fun streamUserAgent(url: String): String {
        val client = runCatching { Uri.parse(url).getQueryParameter("c") }
            .getOrNull()
            ?.uppercase()
        return when (client) {
            "IOS" -> IOS_STREAM_USER_AGENT
            else -> YoutubeDeviceResolver.DOWNLOAD_USER_AGENT
        }
    }

    private fun muxAdaptive(videoFile: File, audioFile: File, output: File, container: String) {
        val videoExtractor = MediaExtractor()
        val audioExtractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            videoExtractor.setDataSource(videoFile.absolutePath)
            audioExtractor.setDataSource(audioFile.absolutePath)
            val videoTrack = findTrack(videoExtractor, "video/")
            val audioTrack = findTrack(audioExtractor, "audio/")
            require(videoTrack >= 0) { "Downloaded YouTube video track is invalid" }
            require(audioTrack >= 0) { "Downloaded YouTube audio track is invalid" }

            val outputFormat = if (container == "webm") {
                MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
            } else {
                MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
            }
            muxer = MediaMuxer(output.absolutePath, outputFormat)
            val muxVideoTrack = muxer.addTrack(videoExtractor.getTrackFormat(videoTrack))
            val muxAudioTrack = muxer.addTrack(audioExtractor.getTrackFormat(audioTrack))
            muxer.start()
            copyTrack(videoExtractor, videoTrack, muxer, muxVideoTrack)
            copyTrack(audioExtractor, audioTrack, muxer, muxAudioTrack)
            muxer.stop()
        } finally {
            runCatching { muxer?.release() }
            videoExtractor.release()
            audioExtractor.release()
        }
    }

    private fun findTrack(extractor: MediaExtractor, prefix: String): Int {
        for (index in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(index).getString(android.media.MediaFormat.KEY_MIME).orEmpty()
            if (mime.startsWith(prefix)) return index
        }
        return -1
    }

    private fun copyTrack(extractor: MediaExtractor, sourceTrack: Int, muxer: MediaMuxer, targetTrack: Int) {
        extractor.selectTrack(sourceTrack)
        extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        val buffer = ByteBuffer.allocateDirect(MAX_SAMPLE_BYTES)
        val info = MediaCodec.BufferInfo()
        while (true) {
            buffer.clear()
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) break
            info.set(0, size, extractor.sampleTime.coerceAtLeast(0L), extractor.sampleFlags)
            muxer.writeSampleData(targetTrack, buffer, info)
            if (!extractor.advance()) break
        }
        extractor.unselectTrack(sourceTrack)
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

    private fun friendlyError(error: Throwable): String = when {
        error is DownloadPaused -> "Paused"
        error is DownloadStopped -> "Download stopped"
        error.message?.contains("Canceled", ignoreCase = true) == true -> "Download paused"
        else -> error.message ?: "YouTube download failed"
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private class DownloadPaused : Exception()
    private class DownloadStopped : Exception()
    private class RefreshableYoutubeUrl(val code: Int) : Exception()

    companion object {
        private const val STREAM_BUFFER_BYTES = 64 * 1024
        private const val YOUTUBE_RANGE_BYTES = 4L * 1024L * 1024L
        private const val MAX_MEDIA_URL_REFRESHES = 2
        private const val MAX_SAMPLE_BYTES = 16 * 1024 * 1024
        private const val PROGRESSIVE_PART = "youtube-progressive.part"
        private const val VIDEO_PART = "youtube-video.part"
        private const val AUDIO_PART = "youtube-audio.part"
        private const val MUXED_FILE = "youtube-merged.mp4"
        private const val MUXED_WEBM = "youtube-merged.webm"
        private const val IOS_STREAM_USER_AGENT =
            "com.google.ios.youtube/21.03.2 (iPhone16,2; U; CPU iOS 18_7_2 like Mac OS X; en_US)"

        fun tempDir(context: Context, id: String): File =
            File(context.cacheDir, "secure_youtube/${SecureMediaStore.safe(id)}")

        fun cleanupPlaintext(context: Context) {
            val root = File(context.cacheDir, "secure_youtube")
            root.listFiles()?.forEach { dir ->
                File(dir, MUXED_FILE).delete()
                File(dir, MUXED_WEBM).delete()
            }
        }
    }
}
