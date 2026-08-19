package com.easyeducation.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        SecureDownloadService.resumePending(context)
        // Keep legacy jobs resumable for users upgrading from the WebView-based app.
        HlsDownloadService.resume(context)
        YoutubeDownloadService.resume(context)
    }
}
