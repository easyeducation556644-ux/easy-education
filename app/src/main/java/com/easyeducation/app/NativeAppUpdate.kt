package com.easyeducation.app

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

data class NativeAppUpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val force: Boolean,
    val notes: String,
)

/**
 * Secure self-update flow for the directly distributed APK.
 * DownloadManager keeps transferring in the background; Android's package installer still requires
 * explicit user confirmation for the final install.
 */
object NativeAppUpdateManager {
    private const val UPDATE_URL = "https://easy-education.vercel.app/app-update.json"
    private const val PREFS = "native_app_update_v1"
    private const val KEY_DOWNLOAD_ID = "download_id"
    private const val KEY_INFO = "update_info"
    private const val CHECK_INTERVAL_MS = 30L * 60L * 1000L
    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val RELEASE_PATH_PREFIX = "/easyeducation556644-ux/easy-education/releases/download/"

    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()
    private val main = Handler(Looper.getMainLooper())
    private val checkInFlight = AtomicBoolean(false)

    @Volatile private var lastCheckAtMs = 0L
    @Volatile private var dismissedForProcess = false
    @Volatile private var dialog: AlertDialog? = null
    @Volatile private var monitorToken = 0

    fun onActivityResumed(activity: Activity) {
        if (activity !is MainActivity || activity.isFinishing || activity.isDestroyed) return
        readPending(activity)?.let { (info, id) ->
            handlePending(activity, info, id)
            return
        }
        if (dismissedForProcess) return
        val now = System.currentTimeMillis()
        if (now - lastCheckAtMs < CHECK_INTERVAL_MS) return
        lastCheckAtMs = now
        checkRemote(activity)
    }

    fun onActivityPaused(activity: Activity) {
        if (activity !is MainActivity) return
        monitorToken += 1
        dialog?.takeIf { it.isShowing }?.let { runCatching { it.dismiss() } }
        dialog = null
    }

    private fun checkRemote(activity: Activity) {
        if (!checkInFlight.compareAndSet(false, true)) return
        Thread {
            val info = runCatching {
                http.newCall(
                    Request.Builder()
                        .url(UPDATE_URL)
                        .header("Accept", "application/json")
                        .header("Cache-Control", "no-cache")
                        .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
                        .build(),
                ).execute().use { response ->
                    if (!response.isSuccessful) null
                    else parseInfo(JSONObject(response.body?.string().orEmpty()))
                }
            }.getOrNull()
            checkInFlight.set(false)
            if (info == null || info.versionCode <= BuildConfig.VERSION_CODE) return@Thread
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) showAvailable(activity, info)
            }
        }.start()
    }

    private fun showAvailable(activity: Activity, info: NativeAppUpdateInfo) {
        if (dialog?.isShowing == true) return
        val message = buildString {
            append("Easy Education ${info.versionName} is available.")
            if (info.notes.isNotBlank()) append("\n\n${info.notes.take(700)}")
            append("\n\nThe APK will download in the background. Android will ask you to confirm installation when it is ready.")
        }
        dialog = AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(message)
            .setPositiveButton("Update Now") { _, _ -> startDownload(activity, info) }
            .apply {
                if (!info.force) setNegativeButton("Later") { _, _ -> dismissedForProcess = true }
            }
            .setCancelable(!info.force)
            .create()
            .also { it.show() }
    }

    private fun startDownload(activity: Activity, info: NativeAppUpdateInfo) {
        if (!validReleaseUrl(info.apkUrl)) return
        val manager = activity.getSystemService(DownloadManager::class.java)
        val filename = "Easy-Education-${info.versionName.ifBlank { info.versionCode.toString() }}.apk"
        val request = DownloadManager.Request(Uri.parse(info.apkUrl))
            .setTitle("Easy Education ${info.versionName}")
            .setDescription("Downloading app update")
            .setMimeType(APK_MIME)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, filename)
        val id = runCatching { manager.enqueue(request) }.getOrElse {
            showSimple(activity, "Update download failed", "Could not start the update download. Please try again.")
            return
        }
        savePending(activity, info, id)
        showDownloadProgress(activity, info, id)
    }

    private fun handlePending(activity: Activity, info: NativeAppUpdateInfo, id: Long) {
        if (info.versionCode <= BuildConfig.VERSION_CODE) {
            clearPending(activity)
            return
        }
        val state = query(activity, id)
        when (state?.status) {
            DownloadManager.STATUS_SUCCESSFUL -> showInstallReady(activity, info, id)
            DownloadManager.STATUS_FAILED -> {
                clearPending(activity)
                showRetry(activity, info, state.reason)
            }
            DownloadManager.STATUS_PENDING,
            DownloadManager.STATUS_PAUSED,
            DownloadManager.STATUS_RUNNING -> showDownloadProgress(activity, info, id)
            else -> {
                clearPending(activity)
                if (!dismissedForProcess) checkRemote(activity)
            }
        }
    }

    private fun showDownloadProgress(activity: Activity, info: NativeAppUpdateInfo, id: Long) {
        if (dialog?.isShowing == true) return
        val density = activity.resources.displayMetrics.density
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (24 * density).roundToInt()
            setPadding(pad, 4, pad, 4)
        }
        val statusText = TextView(activity).apply {
            text = "Preparing download…"
            textSize = 15f
        }
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            max = 100
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = (14 * density).roundToInt() }
        }
        container.addView(statusText)
        container.addView(progress)

        val shown = AlertDialog.Builder(activity)
            .setTitle("Downloading update")
            .setView(container)
            .setNegativeButton("Run in background", null)
            .setCancelable(true)
            .create()
        dialog = shown
        shown.show()

        val token = ++monitorToken
        fun tick() {
            if (token != monitorToken || activity.isFinishing || activity.isDestroyed) return
            val state = query(activity, id)
            when (state?.status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    if (shown.isShowing) runCatching { shown.dismiss() }
                    dialog = null
                    showInstallReady(activity, info, id)
                    return
                }
                DownloadManager.STATUS_FAILED -> {
                    if (shown.isShowing) runCatching { shown.dismiss() }
                    dialog = null
                    clearPending(activity)
                    showRetry(activity, info, state.reason)
                    return
                }
                DownloadManager.STATUS_RUNNING -> {
                    if (state.totalBytes > 0L) {
                        progress.isIndeterminate = false
                        progress.progress = state.progress
                        statusText.text = "Downloading… ${state.progress}%"
                    } else {
                        progress.isIndeterminate = true
                        statusText.text = "Downloading…"
                    }
                }
                DownloadManager.STATUS_PAUSED -> statusText.text = "Download paused by Android. It will continue when the connection is available."
                DownloadManager.STATUS_PENDING -> statusText.text = "Waiting to start download…"
                else -> statusText.text = "Preparing download…"
            }
            main.postDelayed({ tick() }, 900L)
        }
        main.post { tick() }
    }

    private fun showRetry(activity: Activity, info: NativeAppUpdateInfo, reason: Int) {
        if (dialog?.isShowing == true) return
        dialog = AlertDialog.Builder(activity)
            .setTitle("Update download stopped")
            .setMessage("Android could not finish the update download (reason $reason). You can retry now.")
            .setPositiveButton("Retry") { _, _ -> startDownload(activity, info) }
            .apply {
                if (!info.force) setNegativeButton("Later") { _, _ -> dismissedForProcess = true }
            }
            .setCancelable(!info.force)
            .create()
            .also { it.show() }
    }

    private fun showInstallReady(activity: Activity, info: NativeAppUpdateInfo, id: Long) {
        if (dialog?.isShowing == true) return
        dialog = AlertDialog.Builder(activity)
            .setTitle("Update ready")
            .setMessage("Easy Education ${info.versionName} has finished downloading. Tap Install Update to continue with Android's installer.")
            .setPositiveButton("Install Update") { _, _ -> verifyAndInstall(activity, info, id) }
            .apply { if (!info.force) setNegativeButton("Later", null) }
            .setCancelable(!info.force)
            .create()
            .also { it.show() }
    }

    private fun verifyAndInstall(activity: Activity, info: NativeAppUpdateInfo, id: Long) {
        val manager = activity.getSystemService(DownloadManager::class.java)
        val uri = manager.getUriForDownloadedFile(id) ?: run {
            clearPending(activity)
            showSimple(activity, "Update file missing", "The downloaded APK is no longer available. Please download the update again.")
            return
        }
        Thread {
            val expected = info.sha256.trim().lowercase(Locale.US)
            val valid = expected.isBlank() || runCatching {
                activity.contentResolver.openInputStream(uri)?.use { stream ->
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        val read = stream.read(buffer)
                        if (read <= 0) break
                        digest.update(buffer, 0, read)
                    }
                    digest.digest().joinToString("") { "%02x".format(it) } == expected
                } ?: false
            }.getOrDefault(false)
            activity.runOnUiThread {
                if (!valid) {
                    clearPending(activity)
                    showSimple(activity, "Update verification failed", "The APK did not match the signed release checksum. Please download it again.")
                } else {
                    launchInstaller(activity, uri)
                }
            }
        }.start()
    }

    private fun launchInstaller(activity: Activity, uri: Uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            runCatching {
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
                )
            }.onFailure {
                showSimple(activity, "Permission required", "Allow Easy Education to install updates, then return and tap Install Update again.")
            }
            return
        }
        runCatching {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, APK_MIME)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
            )
        }.onFailure {
            showSimple(activity, "Could not open installer", "Android could not open the downloaded APK. Please retry the update.")
        }
    }

    private data class DownloadState(
        val status: Int,
        val progress: Int,
        val totalBytes: Long,
        val reason: Int,
    )

    private fun query(context: Context, id: Long): DownloadState? {
        if (id <= 0L) return null
        val manager = context.getSystemService(DownloadManager::class.java)
        return runCatching {
            manager.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).coerceAtLeast(0L)
                val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                val percent = if (total > 0L) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else 0
                DownloadState(status, percent, total, reason)
            }
        }.getOrNull()
    }

    private fun parseInfo(json: JSONObject): NativeAppUpdateInfo? {
        val code = json.optInt("versionCode", 0)
        val name = json.optString("versionName").trim()
        val url = json.optString("apkUrl").trim()
        if (code <= 0 || name.isBlank() || !validReleaseUrl(url)) return null
        return NativeAppUpdateInfo(
            versionCode = code,
            versionName = name,
            apkUrl = url,
            sha256 = json.optString("sha256").trim(),
            force = json.optBoolean("force", false),
            notes = json.optString("notes").trim(),
        )
    }

    private fun validReleaseUrl(value: String): Boolean = runCatching {
        val uri = Uri.parse(value)
        uri.scheme.equals("https", true) &&
            uri.host.equals("github.com", true) &&
            uri.path.orEmpty().startsWith(RELEASE_PATH_PREFIX)
    }.getOrDefault(false)

    private fun savePending(context: Context, info: NativeAppUpdateInfo, id: Long) {
        val json = JSONObject()
            .put("versionCode", info.versionCode)
            .put("versionName", info.versionName)
            .put("apkUrl", info.apkUrl)
            .put("sha256", info.sha256)
            .put("force", info.force)
            .put("notes", info.notes)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_DOWNLOAD_ID, id)
            .putString(KEY_INFO, json.toString())
            .apply()
    }

    private fun readPending(context: Context): Pair<NativeAppUpdateInfo, Long>? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        val raw = prefs.getString(KEY_INFO, null).orEmpty()
        if (id <= 0L || raw.isBlank()) return null
        val info = runCatching { parseInfo(JSONObject(raw)) }.getOrNull() ?: return null
        return info to id
    }

    private fun clearPending(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_INFO)
            .apply()
    }

    private fun showSimple(activity: Activity, title: String, message: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        dialog = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .create()
            .also { it.show() }
    }
}
