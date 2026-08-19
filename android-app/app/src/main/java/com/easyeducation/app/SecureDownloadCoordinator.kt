package com.easyeducation.app

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import java.net.URI

object SecureDownloadCoordinator {
    fun isHlsSource(value: String): Boolean = runCatching {
        URI(value).path?.lowercase()?.endsWith(".m3u8") == true
    }.getOrDefault(value.substringBefore('?').lowercase().endsWith(".m3u8"))

    fun start(context: Context, task: SecureDownloadTask) {
        val store = SecureMediaStore(context)
        val previous = store.get(task.id)
        DownloadRuntime.cancel(task.id)
        val generation = nextGeneration(previous)
        val sourceChanged = previous != null && (
            previous.sourceUrl != task.sourceUrl ||
                previous.height != task.height ||
                previous.sourceKind != task.sourceKind
            )
        if (sourceChanged || previous?.state == "completed") {
            store.resetChunks(task.id)
            SecureHlsDownloadService.tempDir(context, task.id).deleteRecursively()
        }
        val queued = task.copy(
            generation = generation,
            state = "queued",
            phase = "preparing",
            phaseProgress = 0,
            downloadedBytes = if (!sourceChanged) task.downloadedBytes else 0,
            chunkCount = if (!sourceChanged) task.chunkCount else 0,
            error = null,
        )
        store.save(queued)
        DownloadNotifier(context).cancelState(task.id)
        launch(context, queued)
    }

    fun resume(context: Context, id: String) {
        val store = SecureMediaStore(context)
        val task = store.get(id) ?: return
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid.isNullOrBlank() || uid != task.userId) return
        DownloadRuntime.cancel(id)
        val queued = task.copy(
            generation = nextGeneration(task),
            state = "queued",
            phase = "preparing",
            phaseProgress = task.progress.coerceAtMost(95),
            error = null,
        )
        store.save(queued)
        DownloadNotifier(context).cancelState(id)
        launch(context, queued)
    }

    fun pause(context: Context, id: String) {
        DownloadRuntime.cancel(id)
        val store = SecureMediaStore(context)
        val task = store.get(id) ?: return
        if (task.state !in setOf("queued", "downloading")) return
        val paused = task.copy(state = "paused", phase = "paused", error = null)
        store.save(paused)
        DownloadNotifier(context).paused(paused)
    }

    fun remove(context: Context, id: String) {
        DownloadRuntime.cancel(id)
        SecureHlsDownloadService.cancelActiveTransform(id)
        val store = SecureMediaStore(context)
        store.get(id)?.let { store.save(it.copy(state = "deleting", phase = "deleting")) }
        SecureHlsDownloadService.tempDir(context, id).deleteRecursively()
        store.remove(id)
        // Re-run cleanup once because an already-open worker may have been unwinding.
        SecureHlsDownloadService.tempDir(context, id).deleteRecursively()
        store.secureDir(id).deleteRecursively()
        DownloadNotifier(context).cancelAll(id)
    }

    fun resumePending(context: Context) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        SecureMediaStore(context).pendingForUser(uid).forEach { task ->
            val refreshed = task.copy(generation = nextGeneration(task), state = "queued", phase = "preparing")
            SecureMediaStore(context).save(refreshed)
            launch(context, refreshed)
        }
    }

    private fun launch(context: Context, task: SecureDownloadTask) {
        val service = if (task.sourceKind == "hls" || isHlsSource(task.sourceUrl)) {
            SecureHlsDownloadService::class.java
        } else {
            SecureDownloadService::class.java
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, service)
                .putExtra(SecureDownloadService.EXTRA_ID, task.id)
                .putExtra(SecureDownloadService.EXTRA_GENERATION, task.generation),
        )
    }

    private fun nextGeneration(task: SecureDownloadTask?): Long =
        ((task?.generation ?: 0L) + 1L).coerceAtLeast(System.currentTimeMillis())
}
