package com.easyeducation.app

import android.content.Context
import org.json.JSONObject

data class DownloadTask(
    val id: String,
    val title: String,
    val playlistUrl: String,
    val height: Int,
    val completed: Int = 0,
    val total: Int = 0,
    val state: String = "queued",
    val error: String? = null,
)

class DownloadStore(context: Context) {
    private val prefs = context.getSharedPreferences("native_downloads", Context.MODE_PRIVATE)

    fun save(task: DownloadTask) {
        val json = JSONObject()
            .put("id", task.id).put("title", task.title)
            .put("playlistUrl", task.playlistUrl).put("height", task.height)
            .put("completed", task.completed).put("total", task.total)
            .put("state", task.state).put("error", task.error)
        prefs.edit().putString(task.id, json.toString()).apply()
    }

    fun get(id: String): DownloadTask? = prefs.getString(id, null)?.let(::decode)
    fun all(): List<DownloadTask> = prefs.all.values.mapNotNull { (it as? String)?.let(::decode) }
    fun pending(): List<DownloadTask> = all().filter { it.state in setOf("queued", "downloading") }

    private fun decode(raw: String): DownloadTask? = runCatching {
        val j = JSONObject(raw)
        DownloadTask(j.getString("id"), j.getString("title"), j.getString("playlistUrl"),
            j.optInt("height", 360), j.optInt("completed"), j.optInt("total"),
            j.optString("state", "queued"), j.optString("error").ifBlank { null })
    }.getOrNull()
}
