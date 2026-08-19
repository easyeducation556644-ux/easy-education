package com.easyeducation.app

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.net.URI

object SecureDownloadCoordinator {
    fun isHlsSource(value: String): Boolean = runCatching {
        URI(value).path?.lowercase()?.endsWith(".m3u8") == true
    }.getOrDefault(value.substringBefore('?').lowercase().endsWith(".m3u8"))

    fun start(context: Context, task: SecureDownloadTask) {
        SecureMediaStore(context).save(task.copy(state = "queued", error = null))
        launch(context, task)
    }

    fun resume(context: Context, id: String) {
        val store = SecureMediaStore(context)
        val task = store.get(id) ?: return
        val queued = task.copy(state = "queued", error = null)
        store.save(queued)
        launch(context, queued)
    }

    fun pause(context: Context, id: String) {
        val store = SecureMediaStore(context)
        store.get(id)?.let { store.save(it.copy(state = "paused", error = null)) }
    }

    fun remove(context: Context, id: String) {
        SecureDownloadService.remove(context, id)
        SecureHlsDownloadService.tempDir(context, id).deleteRecursively()
    }

    fun resumePending(context: Context) {
        SecureMediaStore(context).pending().forEach { task -> launch(context, task) }
    }

    private fun launch(context: Context, task: SecureDownloadTask) {
        val service = if (isHlsSource(task.sourceUrl)) SecureHlsDownloadService::class.java else SecureDownloadService::class.java
        ContextCompat.startForegroundService(
            context,
            Intent(context, service).putExtra(SecureDownloadService.EXTRA_ID, task.id),
        )
    }
}
