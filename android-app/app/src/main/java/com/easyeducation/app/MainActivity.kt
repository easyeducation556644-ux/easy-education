package com.easyeducation.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.URI

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var store: DownloadStore

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = DownloadStore(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = WebChromeClient()
            webViewClient = LockedWebClient()
        }
        WebViewCompat.addWebMessageListener(web, "EasyEducationNative", setOf(APP_ORIGIN)) {
                _, message, sourceOrigin, isMainFrame, replyProxy ->
            if (isMainFrame && sourceOrigin.toString() == APP_ORIGIN) {
                message.data?.let { handleMessage(it, replyProxy) }
            }
        }
        setContentView(web)
        web.loadUrl(APP_ORIGIN)
        HlsDownloadService.resume(this)
    }

    private fun handleMessage(raw: String, reply: JavaScriptReplyProxy) {
        var requestId = ""
        val response = runCatching {
            val request = JSONObject(raw)
            requestId = request.optString("requestId")
            when (request.getString("action")) {
                "start" -> {
                    val id = request.getString("id")
                    val playlistUrl = request.getString("playlistUrl")
                    require(isAllowedMediaUrl(playlistUrl)) { "Unsupported media host" }
                    store.save(DownloadTask(id, request.optString("title", "Class video"),
                        playlistUrl, request.optInt("height", 360)))
                    HlsDownloadService.start(this, id)
                    JSONObject().put("ok", true).put("id", id)
                }
                "status" -> {
                    val id = request.getString("id")
                    val task = store.get(id) ?: error("Download not found")
                    val progress = if (task.total > 0) task.completed * 100 / task.total else 0
                    JSONObject().put("ok", true).put("id", id).put("state", task.state)
                        .put("progress", progress).put("completed", task.completed).put("total", task.total)
                        .put("error", task.error)
                        .put("playbackUrl", "https://native.easyeducation.local/${Uri.encode(id)}/playlist.m3u8")
                }
                else -> error("Unknown native action")
            }
        }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "Native error") }
        response.put("requestId", requestId)
        reply.postMessage(response.toString())
    }

    private fun isAllowedMediaUrl(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase() ?: return false
        URI(value).scheme == "https" && (host == "rumble.com" || host.endsWith(".rumble.com") ||
            host == "rumble.cloud" || host.endsWith(".rumble.cloud"))
    }.getOrDefault(false)

    private inner class LockedWebClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "https" && uri.host == APP_HOST) return false
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            return true
        }

        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
            val uri = request.url
            if (uri.host != "native.easyeducation.local") return super.shouldInterceptRequest(view, request)
            val parts = uri.pathSegments
            if (parts.size < 2) return null
            val file = File(filesDir, "offline/${HlsDownloadService.safe(parts[0])}/${parts.drop(1).joinToString("/")}")
            if (!file.exists()) return WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), null)
            val mime = if (file.extension == "m3u8") "application/vnd.apple.mpegurl" else "video/mp2t"
            return WebResourceResponse(mime, null, FileInputStream(file))
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }

    companion object {
        private const val APP_HOST = "easy-education.vercel.app"
        private const val APP_ORIGIN = "https://$APP_HOST"
    }
}
