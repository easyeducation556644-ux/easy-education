package com.easyeducation.app

import android.app.NotificationManager
import android.content.Context
import java.io.File

/**
 * v1/WebView downloads stored a playable video.mp4 under filesDir/offline.
 * Native v2 never consumes those plaintext files. Purge them once on upgrade so
 * uninstall/re-download is not required to get the new encrypted-only guarantee.
 */
object LegacyDownloadCleanup {
    private const val PREFS = "native_secure_migration_v2"
    private const val DONE = "legacy_plaintext_removed"

    fun runOnce(context: Context) {
        val app = context.applicationContext
        val migration = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (migration.getBoolean(DONE, false)) return

        val oldStore = DownloadStore(app)
        val oldTasks = oldStore.all()
        val manager = app.getSystemService(NotificationManager::class.java)
        oldTasks.forEach { task ->
            runCatching { manager.cancel(HlsDownloadService.notificationId(task.id)) }
        }

        val legacyRoot = File(app.filesDir, "offline")
        val deleted = !legacyRoot.exists() || legacyRoot.deleteRecursively()
        if (!deleted || legacyRoot.exists()) return

        app.getSharedPreferences("native_downloads", Context.MODE_PRIVATE).edit().clear().commit()
        migration.edit().putBoolean(DONE, true).commit()
    }
}
