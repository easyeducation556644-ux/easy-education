package com.easyeducation.app

import okhttp3.Call
import okhttp3.Response
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks active network calls so Pause/Delete are real transport-level operations,
 * not only UI state changes. Generation checks in the download workers provide the
 * second layer of protection against stale workers writing after a quick resume.
 */
object DownloadRuntime {
    private val calls = ConcurrentHashMap<String, MutableSet<Call>>()

    fun <T> execute(downloadId: String, call: Call, block: (Response) -> T): T {
        val set = calls.computeIfAbsent(downloadId) { ConcurrentHashMap.newKeySet() }
        set.add(call)
        return try {
            call.execute().use(block)
        } finally {
            set.remove(call)
            if (set.isEmpty()) calls.remove(downloadId, set)
        }
    }

    fun cancel(downloadId: String) {
        calls[downloadId]?.toList()?.forEach { call -> runCatching { call.cancel() } }
    }

    fun hasActiveCall(downloadId: String): Boolean = calls[downloadId]?.isNotEmpty() == true
}
