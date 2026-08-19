package com.easyeducation.app

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec


data class SecureDownloadTask(
    val id: String,
    val userId: String,
    val courseId: String,
    val classId: String,
    val title: String,
    val courseTitle: String,
    val sourceUrl: String,
    val height: Int = 480,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val chunkCount: Int = 0,
    val state: String = "queued",
    val error: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
) {
    val progress: Int
        get() = if (totalBytes > 0) ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(0, 100) else 0

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("userId", userId)
        .put("courseId", courseId)
        .put("classId", classId)
        .put("title", title)
        .put("courseTitle", courseTitle)
        .put("sourceUrl", sourceUrl)
        .put("height", height)
        .put("downloadedBytes", downloadedBytes)
        .put("totalBytes", totalBytes)
        .put("chunkCount", chunkCount)
        .put("state", state)
        .put("error", error)
        .put("updatedAt", updatedAt)

    companion object {
        fun fromJson(raw: String): SecureDownloadTask? = runCatching {
            val json = JSONObject(raw)
            SecureDownloadTask(
                id = json.getString("id"),
                userId = json.getString("userId"),
                courseId = json.optString("courseId"),
                classId = json.getString("classId"),
                title = json.optString("title", "Class video"),
                courseTitle = json.optString("courseTitle"),
                sourceUrl = json.optString("sourceUrl"),
                height = json.optInt("height", 480),
                downloadedBytes = json.optLong("downloadedBytes", 0),
                totalBytes = json.optLong("totalBytes", 0),
                chunkCount = json.optInt("chunkCount", 0),
                state = json.optString("state", "queued"),
                error = json.optString("error").ifBlank { null },
                updatedAt = json.optLong("updatedAt", 0),
            )
        }.getOrNull()
    }
}

class SecureMediaStore(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(task: SecureDownloadTask) {
        prefs.edit().putString(task.id, task.copy(updatedAt = System.currentTimeMillis()).toJson().toString()).apply()
    }

    fun get(id: String): SecureDownloadTask? = prefs.getString(id, null)?.let(SecureDownloadTask::fromJson)

    fun allForUser(uid: String): List<SecureDownloadTask> = prefs.all.values
        .mapNotNull { (it as? String)?.let(SecureDownloadTask::fromJson) }
        .filter { it.userId == uid }
        .sortedByDescending { it.updatedAt }

    fun pending(): List<SecureDownloadTask> = prefs.all.values
        .mapNotNull { (it as? String)?.let(SecureDownloadTask::fromJson) }
        .filter { it.state in setOf("queued", "downloading") }

    fun remove(id: String) {
        secureDir(id).deleteRecursively()
        prefs.edit().remove(id).apply()
    }

    fun resetChunks(id: String) {
        secureDir(id).deleteRecursively()
    }

    fun writeEncryptedChunk(task: SecureDownloadTask, index: Int, plain: ByteArray) {
        require(plain.isNotEmpty()) { "Cannot encrypt an empty chunk" }
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        cipher.updateAAD(aad(task.userId, task.classId, index))
        val encrypted = cipher.doFinal(plain)
        val output = chunkFile(task.id, index)
        output.parentFile?.mkdirs()
        output.outputStream().use { stream ->
            stream.write(cipher.iv)
            stream.write(encrypted)
        }
    }

    fun readDecryptedChunk(task: SecureDownloadTask, index: Int): ByteArray {
        require(task.userId.isNotBlank()) { "Download owner is missing" }
        val input = chunkFile(task.id, index).readBytes()
        require(input.size > IV_BYTES) { "Encrypted media chunk is corrupt" }
        val iv = input.copyOfRange(0, IV_BYTES)
        val payload = input.copyOfRange(IV_BYTES, input.size)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad(task.userId, task.classId, index))
        return cipher.doFinal(payload)
    }

    fun hasCompleteMedia(task: SecureDownloadTask): Boolean {
        if (task.state != "completed" || task.totalBytes <= 0 || task.chunkCount <= 0) return false
        return (0 until task.chunkCount).all { chunkFile(task.id, it).exists() }
    }

    fun secureDir(id: String): File = File(context.filesDir, "secure_media/${safe(id)}")

    private fun chunkFile(id: String, index: Int): File = File(secureDir(id), "chunk-%06d.bin".format(index))

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun aad(uid: String, classId: String, index: Int): ByteArray =
        "easy-education-v2|$uid|$classId|$index".toByteArray(Charsets.UTF_8)

    companion object {
        const val CHUNK_BYTES = 2 * 1024 * 1024
        private const val PREFS = "secure_downloads_v2"
        private const val KEY_ALIAS = "easy_education_offline_media_v2"
        private const val CIPHER = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12

        fun downloadId(uid: String, classId: String): String = safe("$uid:$classId")

        fun safe(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(40)
    }
}

class SecureChunkDataSource(
    context: Context,
    private val downloadId: String,
    private val expectedUid: String,
) : BaseDataSource(false) {
    private val store = SecureMediaStore(context.applicationContext)
    private var task: SecureDownloadTask? = null
    private var opened = false
    private var readPosition = 0L
    private var bytesRemaining = 0L
    private var loadedChunkIndex = -1
    private var loadedChunk = ByteArray(0)
    private var uri: Uri? = null

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        val current = store.get(downloadId) ?: error("Offline download was not found")
        require(current.userId == expectedUid) { "This download belongs to another account" }
        require(store.hasCompleteMedia(current)) { "Offline download is incomplete" }
        task = current
        uri = dataSpec.uri
        readPosition = dataSpec.position
        require(readPosition in 0..current.totalBytes) { "Invalid offline media position" }
        val requested = if (dataSpec.length == C.LENGTH_UNSET.toLong()) {
            current.totalBytes - readPosition
        } else {
            minOf(dataSpec.length, current.totalBytes - readPosition)
        }
        bytesRemaining = requested.coerceAtLeast(0)
        opened = true
        transferStarted(dataSpec)
        return bytesRemaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (bytesRemaining <= 0) return C.RESULT_END_OF_INPUT
        val current = task ?: return C.RESULT_END_OF_INPUT
        val chunkIndex = (readPosition / SecureMediaStore.CHUNK_BYTES).toInt()
        val offsetInChunk = (readPosition % SecureMediaStore.CHUNK_BYTES).toInt()
        if (loadedChunkIndex != chunkIndex) {
            loadedChunk = store.readDecryptedChunk(current, chunkIndex)
            loadedChunkIndex = chunkIndex
        }
        val available = loadedChunk.size - offsetInChunk
        if (available <= 0) return C.RESULT_END_OF_INPUT
        val count = minOf(length, available, bytesRemaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        loadedChunk.copyInto(buffer, offset, offsetInChunk, offsetInChunk + count)
        readPosition += count
        bytesRemaining -= count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        uri = null
        task = null
        loadedChunk = ByteArray(0)
        loadedChunkIndex = -1
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    class Factory(
        private val context: Context,
        private val downloadId: String,
        private val uid: String,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = SecureChunkDataSource(context, downloadId, uid)
    }
}
