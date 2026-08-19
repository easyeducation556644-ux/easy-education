package com.easyeducation.app

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import java.net.URI

object SecureDownloadCoordinator {
    private const val NETWORK_WAIT_PHASE = "waiting-network"

    fun isHlsSource(value: String): Boolean = runCatching {
        URI(value).path?.lowercase()?.endsWith(".m3u8") == true
    }.getOrDefault(value.substringBefore('?').lowercase().endsWith(".m3u8"))

    fun start(context: Context, task: SecureDownloadTask) {
        if (!DownloadPreferences.networkAllowed(context)) return
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
            purgeWorkingFiles(context, task.id)
            store.resetChunks(task.id)
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
        if (!DownloadPreferences.networkAllowed(context)) {
            val paused = task.copy(
                state = "paused",
                phase = NETWORK_WAIT_PHASE,
                error = "Waiting for Wi-Fi because Wi-Fi only downloads are enabled.",
            )
            store.save(paused)
            DownloadNotifier(context).paused(paused)
            return
        }
        queueAndLaunch(context, store, task)
    }

    /** Explicit user pause. This state is intentionally never selected by resumePending(). */
    fun pause(context: Context, id: String) {
        DownloadRuntime.cancel(id)
        SecureHlsDownloadService.cancelActiveTransform(id)
        val store = SecureMediaStore(context)
        val task = store.get(id) ?: return
        if (task.state !in setOf("queued", "downloading")) return
        val paused = task.copy(state = "paused", phase = "paused", error = null)
        store.save(paused)
        DownloadNotifier(context).paused(paused)
    }

    /** Automatic pause used only for connectivity / Wi-Fi policy transitions. */
    fun pauseForNetwork(context: Context, id: String, message: String) {
        DownloadRuntime.cancel(id)
        SecureHlsDownloadService.cancelActiveTransform(id)
        val store = SecureMediaStore(context)
        val task = store.get(id) ?: return
        if (task.state !in setOf("queued", "downloading")) return
        val paused = task.copy(
            state = "paused",
            phase = NETWORK_WAIT_PHASE,
            error = message,
        )
        store.save(paused)
        DownloadNotifier(context).paused(paused)
    }

    fun remove(context: Context, id: String) {
        DownloadRuntime.cancel(id)
        SecureHlsDownloadService.cancelActiveTransform(id)
        val store = SecureMediaStore(context)
        store.get(id)?.let { store.save(it.copy(state = "deleting", phase = "deleting")) }
        purgeWorkingFiles(context, id)
        store.remove(id)
        // Repeat after workers unwind so no stale app-private temp path survives deletion.
        purgeWorkingFiles(context, id)
        store.secureDir(id).deleteRecursively()
        DownloadNotifier(context).cancelAll(id)
    }

    fun resumePending(context: Context) {
        if (!DownloadPreferences.networkAllowed(context)) return
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val store = SecureMediaStore(context)
        store.allForUser(uid)
            .filter { task ->
                task.state in setOf("queued", "downloading") ||
                    (task.state == "paused" && task.phase == NETWORK_WAIT_PHASE) ||
                    (task.state == "failed" && isRetryableNetworkMessage(task.error))
            }
            .forEach { task -> queueAndLaunch(context, store, task) }
    }

    fun isRetryableNetworkMessage(message: String?): Boolean {
        val value = message.orEmpty()
        if (value.isBlank()) return false
        return NETWORK_ERROR_PATTERNS.any { pattern -> value.contains(pattern, ignoreCase = true) }
    }

    private fun queueAndLaunch(context: Context, store: SecureMediaStore, task: SecureDownloadTask) {
        DownloadRuntime.cancel(task.id)
        val refreshed = task.copy(
            generation = nextGeneration(task),
            state = "queued",
            phase = "preparing",
            phaseProgress = task.progress.coerceAtMost(95),
            error = null,
        )
        store.save(refreshed)
        DownloadNotifier(context).cancelState(task.id)
        launch(context, refreshed)
    }

    private fun launch(context: Context, task: SecureDownloadTask) {
        val service = when {
            task.sourceKind == "youtube" || YoutubeDeviceResolver.isYoutubeUrl(task.sourceUrl) ->
                SecureYoutubeDownloadService::class.java
            task.sourceKind in setOf("hls", "rumble-hls") || isHlsSource(task.sourceUrl) ->
                SecureHlsDownloadService::class.java
            else -> SecureDownloadService::class.java
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, service)
                .putExtra(SecureDownloadService.EXTRA_ID, task.id)
                .putExtra(SecureDownloadService.EXTRA_GENERATION, task.generation),
        )
    }

    private fun purgeWorkingFiles(context: Context, id: String) {
        SecureHlsDownloadService.tempDir(context, id).deleteRecursively()
        SecureYoutubeDownloadService.tempDir(context, id).deleteRecursively()
    }

    private fun nextGeneration(task: SecureDownloadTask?): Long =
        ((task?.generation ?: 0L) + 1L).coerceAtLeast(System.currentTimeMillis())

    private val NETWORK_ERROR_PATTERNS = listOf(
        "unable to resolve host",
        "failed to connect",
        "network is unreachable",
        "no route to host",
        "connection reset",
        "connection abort",
        "software caused connection abort",
        "unexpected end of stream",
        "stream was reset",
        "socket closed",
        "timeout",
        "timed out",
        "network error",
    )
}
