package com.easyeducation.app

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit

/**
 * Presents the authenticated server-side Rumble range proxy as one seekable progressive
 * media file to Media3. Only a bounded chunk is proxied at a time, so seeking does not
 * require loading the whole video through a single serverless request.
 */
class RumbleProxyDataSource(
    private val classId: String,
    private val height: Int,
    private val totalBytes: Long,
    private val downloadToken: String,
    private val http: OkHttpClient = SHARED_HTTP,
) : BaseDataSource(true) {
    private var currentPosition = 0L
    private var bytesRemaining = 0L
    private var chunkRemaining = 0L
    private var activeCall: Call? = null
    private var activeResponse: Response? = null
    private var input: InputStream? = null
    private var opened = false
    private var currentUri: Uri? = null

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        require(totalBytes > 0L) { "Rumble video size is unavailable" }
        require(dataSpec.position in 0..totalBytes) { "Invalid Rumble playback position" }
        currentPosition = dataSpec.position
        bytesRemaining = if (dataSpec.length == C.LENGTH_UNSET.toLong()) {
            totalBytes - currentPosition
        } else {
            minOf(dataSpec.length, totalBytes - currentPosition)
        }.coerceAtLeast(0L)
        currentUri = dataSpec.uri
        opened = true
        transferStarted(dataSpec)
        return bytesRemaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (bytesRemaining <= 0L) return C.RESULT_END_OF_INPUT
        if (input == null || chunkRemaining <= 0L) openNextChunk()

        val allowed = minOf(
            length.toLong(),
            bytesRemaining,
            chunkRemaining,
            Int.MAX_VALUE.toLong(),
        ).toInt()
        val count = input?.read(buffer, offset, allowed) ?: C.RESULT_END_OF_INPUT
        if (count < 0) {
            closeChunk()
            if (bytesRemaining > 0L) throw IOException("Rumble playback chunk ended early")
            return C.RESULT_END_OF_INPUT
        }
        currentPosition += count
        bytesRemaining -= count
        chunkRemaining -= count
        bytesTransferred(count)
        if (chunkRemaining <= 0L) closeChunk()
        return count
    }

    private fun openNextChunk() {
        closeChunk()
        if (bytesRemaining <= 0L) return
        val end = minOf(totalBytes - 1L, currentPosition + SERVER_CHUNK_BYTES - 1L)
        val url = APP_ORIGIN + "/api/offline-video" +
            "?classId=${Uri.encode(classId)}" +
            "&height=$height" +
            "&start=$currentPosition&end=$end" +
            "&downloadToken=${Uri.encode(downloadToken)}"
        val call = http.newCall(Request.Builder().url(url).get().build())
        activeCall = call
        val response = call.execute()
        activeResponse = response
        if (response.code != 206) {
            val code = response.code
            closeChunk()
            throw IOException("Rumble playback range failed (HTTP $code)")
        }
        val expected = end - currentPosition + 1L
        val range = response.header("Content-Range").orEmpty()
        if (!range.startsWith("bytes $currentPosition-$end/")) {
            closeChunk()
            throw IOException("Rumble server returned the wrong playback range")
        }
        input = response.body?.byteStream() ?: run {
            closeChunk()
            throw IOException("Rumble playback response was empty")
        }
        chunkRemaining = expected
    }

    private fun closeChunk() {
        runCatching { input?.close() }
        input = null
        runCatching { activeResponse?.close() }
        activeResponse = null
        runCatching { activeCall?.cancel() }
        activeCall = null
        chunkRemaining = 0L
    }

    override fun getUri(): Uri? = currentUri

    override fun close() {
        closeChunk()
        currentUri = null
        currentPosition = 0L
        bytesRemaining = 0L
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    class Factory(
        private val classId: String,
        private val height: Int,
        private val totalBytes: Long,
        private val downloadToken: String,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = RumbleProxyDataSource(
            classId = classId,
            height = height,
            totalBytes = totalBytes,
            downloadToken = downloadToken,
        )
    }

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        private const val SERVER_CHUNK_BYTES = 8L * 1024L * 1024L
        private val SHARED_HTTP = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
