package com.easyeducation.app

import android.content.Context
import org.json.JSONObject

data class DownloadTask(
    val id: String,
    val title: String,
    val courseTitle: String,
    val playlistUrl: String = "",
    val downloadUrlBase: String = "",
    val kind: String = "hls",
    val height: Int,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val completed: Int = 0,
    val total: Int = 0,
    val state: String = "queued",
    val error: String? = null,
)

class DownloadStore(context: Context) {
    private val prefs = context.getSharedPreferences("native_downloads", Context.MODE_PRIVATE)

    fun save(task: DownloadTask) {
        val json = JSONObject()
            .put("id", task.id)
            .put("title", task.title)
            .put("courseTitle", task.courseTitle)
            .put("playlistUrl", task.playlistUrl)
            .put("downloadUrlBase", task.downloadUrlBase)
            .put("kind", task.kind)
            .put("height", task.height)
            .put("downloadedBytes", task.downloadedBytes)
            .put("totalBytes", task.totalBytes)
            .put("completed", task.completed)
            .put("total", task.total)
            .put("state", task.state)
            .put("error", task.error)
        prefs.edit().putString(task.id, json.toString()).apply()
    }

    fun get(id: String): DownloadTask? = prefs.getString(id, null)?.let(::decode)
    fun remove(id: String) { prefs.edit().remove(id).apply() }
    fun all(): List<DownloadTask> = prefs.all.values.mapNotNull { (it as? String)?.let(::decode) }
    fun pending(): List<DownloadTask> = all().filter { it.state in setOf("queued", "downloading", "converting") }

    private fun decode(raw: String): DownloadTask? = runCatching {
        val j = JSONObject(raw)
        DownloadTask(
            id = j.getString("id"),
            title = j.optString("title", "Class video"),
            courseTitle = j.optString("courseTitle"),
            playlistUrl = j.optString("playlistUrl"),
            downloadUrlBase = j.optString("downloadUrlBase"),
            kind = j.optString("kind", if (j.optString("playlistUrl").isNotBlank()) "hls" else "mp4"),
            height = j.optInt("height", 360),
            downloadedBytes = j.optLong("downloadedBytes"),
            totalBytes = j.optLong("totalBytes"),
            completed = j.optInt("completed"),
            total = j.optInt("total"),
            state = j.optString("state", "queued"),
            error = j.optString("error").ifBlank { null },
        )
    }.getOrNull()
}
