package com.easyeducation.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

class DownloadNotifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Offline classes", NotificationManager.IMPORTANCE_LOW),
        )
    }

    fun progressNotification(task: SecureDownloadTask): Notification {
        cancelState(task.id)
        val label = when (task.phase) {
            "preparing" -> "Preparing ${qualityLabel(task)}"
            "converting" -> "Preparing offline video"
            "encrypting" -> "Securing offline video"
            else -> "Downloading ${qualityLabel(task)}"
        }
        return base(task)
            .setContentText("$label • ${task.progress}%${bytesText(task)}")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, task.progress, task.totalBytes <= 0)
            .addAction(0, "Pause", actionIntent(ACTION_PAUSE, task.id, 1))
            .addAction(0, "Delete", actionIntent(ACTION_DELETE, task.id, 2))
            .build()
    }

    fun updateProgress(task: SecureDownloadTask) {
        manager.notify(activeId(task.id), progressNotification(task))
    }

    fun paused(task: SecureDownloadTask) {
        manager.cancel(activeId(task.id))
        manager.notify(
            stateId(task.id),
            base(task)
                .setContentText("Paused • ${task.progress}%${bytesText(task)}")
                .setOngoing(false)
                .setProgress(0, 0, false)
                .addAction(0, "Resume", actionIntent(ACTION_RESUME, task.id, 3))
                .addAction(0, "Delete", actionIntent(ACTION_DELETE, task.id, 4))
                .build(),
        )
    }

    fun failed(task: SecureDownloadTask) {
        manager.cancel(activeId(task.id))
        manager.notify(
            stateId(task.id),
            base(task)
                .setContentText(task.error?.take(120) ?: "Download failed")
                .setOngoing(false)
                .setProgress(0, 0, false)
                .addAction(0, "Retry", actionIntent(ACTION_RESUME, task.id, 5))
                .addAction(0, "Delete", actionIntent(ACTION_DELETE, task.id, 6))
                .build(),
        )
    }

    fun completed(task: SecureDownloadTask) {
        manager.cancel(activeId(task.id))
        manager.notify(
            stateId(task.id),
            base(task)
                .setContentText("Ready offline • ${qualityLabel(task)} • ${formatBytes(task.totalBytes)}")
                .setOngoing(false)
                .setProgress(0, 0, false)
                .setAutoCancel(true)
                .build(),
        )
    }

    fun cancelAll(downloadId: String) {
        manager.cancel(activeId(downloadId))
        manager.cancel(stateId(downloadId))
    }

    fun cancelState(downloadId: String) {
        manager.cancel(stateId(downloadId))
    }

    fun activeNotificationId(downloadId: String): Int = activeId(downloadId)

    private fun base(task: SecureDownloadTask): NotificationCompat.Builder {
        val open = PendingIntent.getActivity(
            context,
            stateId(task.id),
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_PATH, "/downloads")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_easy_education)
            .setContentTitle(task.title)
            .setSubText(task.courseTitle)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    }

    private fun actionIntent(action: String, id: String, salt: Int): PendingIntent = PendingIntent.getBroadcast(
        context,
        (SecureMediaStore.safe("$action:$id").hashCode() * 31) + salt,
        Intent(context, DownloadActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_ID, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun bytesText(task: SecureDownloadTask): String = if (task.totalBytes > 0) {
        " • ${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}"
    } else ""

    private fun qualityLabel(task: SecureDownloadTask): String =
        task.qualityLabel.ifBlank { if (task.height > 0) "${task.height}p" else "Original" }

    companion object {
        const val ACTION_PAUSE = "com.easyeducation.app.DOWNLOAD_PAUSE"
        const val ACTION_RESUME = "com.easyeducation.app.DOWNLOAD_RESUME"
        const val ACTION_DELETE = "com.easyeducation.app.DOWNLOAD_DELETE"
        const val EXTRA_ID = "download_id"
        private const val CHANNEL_ID = "secure_offline_classes_v3"

        private fun activeId(id: String): Int = SecureMediaStore.safe("active:$id").hashCode()
        private fun stateId(id: String): Int = SecureMediaStore.safe("state:$id").hashCode()

        fun formatBytes(value: Long): String = when {
            value >= 1024L * 1024L * 1024L -> "%.1f GB".format(value / (1024.0 * 1024.0 * 1024.0))
            value >= 1024L * 1024L -> "%.1f MB".format(value / (1024.0 * 1024.0))
            value >= 1024L -> "%.1f KB".format(value / 1024.0)
            else -> "$value B"
        }
    }
}

class DownloadActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(DownloadNotifier.EXTRA_ID).orEmpty()
        if (id.isBlank()) return
        when (intent.action) {
            DownloadNotifier.ACTION_PAUSE -> SecureDownloadCoordinator.pause(context, id)
            DownloadNotifier.ACTION_RESUME -> SecureDownloadCoordinator.resume(context, id)
            DownloadNotifier.ACTION_DELETE -> SecureDownloadCoordinator.remove(context, id)
        }
    }
}
