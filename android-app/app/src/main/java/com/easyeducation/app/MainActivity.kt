package com.easyeducation.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.URI

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var splashView: View? = null
    private lateinit var store: DownloadStore
    private lateinit var googleSignInClient: GoogleSignInClient
    private lateinit var chrome: AppWebChromeClient
    private var googleReply: JavaScriptReplyProxy? = null
    private var googleRequestId: String = ""

    private val googleLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val response = runCatching {
            val account = GoogleSignIn.getSignedInAccountFromIntent(result.data)
                .getResult(ApiException::class.java)
            val token = account.idToken ?: error("Google ID token was not returned")
            JSONObject().put("ok", true).put("idToken", token)
        }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "Google sign-in failed") }
        response.put("requestId", googleRequestId)
        googleReply?.postMessage(response.toString())
        googleReply = null
        googleRequestId = ""
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = DownloadStore(this)
        val googleOptions = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(getString(R.string.default_web_client_id))
            .requestEmail()
            .build()
        googleSignInClient = GoogleSignIn.getClient(this, googleOptions)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }

        chrome = AppWebChromeClient()
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = chrome
            webViewClient = LockedWebClient()
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "EasyEducationNative", setOf(APP_ORIGIN)) {
                    _, message, sourceOrigin, isMainFrame, replyProxy ->
                if (isMainFrame && sourceOrigin.toString().removeSuffix("/") == APP_ORIGIN) {
                    message.data?.let { handleMessage(it, replyProxy) }
                }
            }
        }

        root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(11, 16, 32)) }
        root.addView(web, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        val restored = savedInstanceState?.let { web.restoreState(it) }
        if (restored == null) {
            web.visibility = View.INVISIBLE
            splashView = buildSplashView().also {
                root.addView(it, FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ))
            }
        }
        setContentView(root)

        if (restored == null) web.loadUrl(APP_ORIGIN) else revealWeb()
        HlsDownloadService.resume(this)
    }

    private fun buildSplashView(): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.rgb(11, 16, 32))

            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.ic_easy_education)
                contentDescription = "Easy Education"
            }, LinearLayout.LayoutParams(112, 112).apply { bottomMargin = 28 })

            addView(TextView(this@MainActivity).apply {
                text = "Easy Education"
                setTextColor(Color.WHITE)
                textSize = 25f
                gravity = Gravity.CENTER
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })

            addView(TextView(this@MainActivity).apply {
                text = "Learn • Grow • Succeed"
                setTextColor(Color.rgb(160, 174, 205))
                textSize = 13f
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 8 })
        }
    }

    private fun revealWeb() {
        web.visibility = View.VISIBLE
        splashView?.animate()?.alpha(0f)?.setDuration(180)?.withEndAction {
            splashView?.let { root.removeView(it) }
            splashView = null
        }?.start()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    private fun handleMessage(raw: String, reply: JavaScriptReplyProxy) {
        val request = runCatching { JSONObject(raw) }.getOrElse {
            reply.postMessage(JSONObject().put("ok", false).put("error", "Invalid native request").toString())
            return
        }
        val requestId = request.optString("requestId")
        if (request.optString("action") == "googleSignIn") {
            googleReply = reply
            googleRequestId = requestId
            googleSignInClient.signOut().addOnCompleteListener {
                googleLauncher.launch(googleSignInClient.signInIntent)
            }
            return
        }

        val response = runCatching {
            when (request.getString("action")) {
                "start" -> {
                    val id = request.getString("id")
                    val kind = request.optString("kind", "hls")
                    val playlistUrl = request.optString("playlistUrl")
                    val downloadUrlBase = request.optString("downloadUrlBase")
                    if (kind == "mp4") {
                        require(isAllowedAppDownloadUrl(downloadUrlBase)) { "Unsupported MP4 download source" }
                    } else {
                        require(isAllowedMediaUrl(playlistUrl)) { "Unsupported media host" }
                    }

                    val existing = store.get(id)
                    val sameSource = existing != null && existing.kind == kind && (
                        (kind == "mp4" && existing.downloadUrlBase == downloadUrlBase) ||
                            (kind != "mp4" && existing.playlistUrl == playlistUrl)
                        )
                    if (!sameSource) HlsDownloadService.offlineDir(this, id).deleteRecursively()

                    store.save(DownloadTask(
                        id = id,
                        title = request.optString("title", "Class video"),
                        courseTitle = request.optString("courseTitle"),
                        playlistUrl = playlistUrl,
                        downloadUrlBase = downloadUrlBase,
                        kind = kind,
                        height = request.optInt("height", 360),
                        downloadedBytes = if (sameSource) existing?.downloadedBytes ?: 0 else 0,
                        totalBytes = request.optLong("totalBytes"),
                        completed = if (sameSource) existing?.completed ?: 0 else 0,
                        total = if (sameSource) existing?.total ?: 0 else 0,
                        state = if (sameSource && existing?.state == "completed" && mp4File(id).exists()) "completed" else "queued",
                    ))
                    HlsDownloadService.start(this, id)
                    JSONObject().put("ok", true).put("id", id)
                }
                "status" -> {
                    val id = request.getString("id")
                    val task = store.get(id) ?: error("Download not found")
                    val mp4 = mp4File(id)
                    var state = task.state
                    if (state == "completed" && !mp4.exists() && task.kind == "hls") {
                        state = "converting"
                        HlsDownloadService.start(this, id)
                    }
                    val progress = if (task.total > 0) task.completed * 100 / task.total else 0
                    val byteProgress = if (task.totalBytes > 0)
                        task.downloadedBytes.toDouble() * 100.0 / task.totalBytes.toDouble()
                    else progress.toDouble()
                    JSONObject().put("ok", true).put("id", id).put("state", state)
                        .put("progress", byteProgress.coerceIn(0.0, 100.0))
                        .put("completed", task.completed).put("total", task.total)
                        .put("downloadedBytes", task.downloadedBytes).put("totalBytes", task.totalBytes)
                        .put("height", task.height).put("title", task.title).put("courseTitle", task.courseTitle)
                        .put("error", task.error)
                        .put("playbackUrl", if (mp4.exists() && mp4.length() > 0)
                            "https://native.easyeducation.local/${Uri.encode(id)}/video.mp4" else JSONObject.NULL)
                }
                "play" -> {
                    val id = request.getString("id")
                    val mp4 = mp4File(id)
                    require(mp4.exists() && mp4.length() > 0) { "Downloaded MP4 is not ready" }
                    startActivity(
                        Intent(this, OfflinePlayerActivity::class.java)
                            .putExtra(OfflinePlayerActivity.EXTRA_ID, id),
                    )
                    JSONObject().put("ok", true).put("id", id)
                }
                "pause" -> {
                    val id = request.getString("id")
                    HlsDownloadService.pause(this, id)
                    JSONObject().put("ok", true).put("id", id)
                }
                "remove" -> {
                    val id = request.getString("id")
                    HlsDownloadService.remove(this, id)
                    JSONObject().put("ok", true).put("id", id)
                }
                else -> error("Unknown native action")
            }
        }.getOrElse { JSONObject().put("ok", false).put("error", it.message ?: "Native error") }
        response.put("requestId", requestId)
        reply.postMessage(response.toString())
    }

    private fun mp4File(id: String) = File(HlsDownloadService.offlineDir(this, id), "video.mp4")

    private fun isAllowedMediaUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        val host = uri.host?.lowercase() ?: return false
        uri.scheme == "https" && (host == "rumble.com" || host.endsWith(".rumble.com") ||
            host == "rumble.cloud" || host.endsWith(".rumble.cloud") ||
            host == "rmbl.ws" || host.endsWith(".rmbl.ws") ||
            host == "1a-1791.com" || host.endsWith(".1a-1791.com"))
    }.getOrDefault(false)

    private fun isAllowedAppDownloadUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "https" && uri.host == APP_HOST && uri.path == "/api/offline-video"
    }.getOrDefault(false)

    private inner class AppWebChromeClient : WebChromeClient() {
        private var customView: View? = null
        private var customViewCallback: CustomViewCallback? = null
        private var previousSystemUiVisibility = 0

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) {
                callback.onCustomViewHidden()
                return
            }
            val decor = window.decorView as FrameLayout
            previousSystemUiVisibility = decor.systemUiVisibility
            customView = view
            customViewCallback = callback
            decor.addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            web.visibility = View.GONE
            decor.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        }

        override fun onHideCustomView() {
            val view = customView ?: return
            val decor = window.decorView as FrameLayout
            decor.removeView(view)
            customView = null
            web.visibility = View.VISIBLE
            decor.systemUiVisibility = previousSystemUiVisibility
            customViewCallback?.onCustomViewHidden()
            customViewCallback = null
        }

        fun isFullscreen(): Boolean = customView != null
    }

    private inner class LockedWebClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val uri = request.url
            if (uri.scheme == "https" && uri.host == APP_HOST) return false
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            return true
        }

        override fun onPageCommitVisible(view: WebView?, url: String?) {
            super.onPageCommitVisible(view, url)
            revealWeb()
        }

        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
            val uri = request.url
            if (uri.host != "native.easyeducation.local") return super.shouldInterceptRequest(view, request)
            val parts = uri.pathSegments
            if (parts.size < 2) return notFoundResponse()
            val file = File(
                filesDir,
                "offline/${HlsDownloadService.safe(parts[0])}/${parts.drop(1).joinToString("/")}",
            )
            if (!file.exists() || !file.isFile) return notFoundResponse()
            return serveLocalFile(request, file)
        }
    }

    private fun notFoundResponse() = WebResourceResponse(
        "text/plain",
        "utf-8",
        404,
        "Not found",
        mapOf("Access-Control-Allow-Origin" to APP_ORIGIN),
        null,
    )

    private fun serveLocalFile(request: WebResourceRequest, file: File): WebResourceResponse {
        val mime = when (file.extension.lowercase()) {
            "mp4", "m4s" -> "video/mp4"
            "m3u8" -> "application/vnd.apple.mpegurl"
            else -> "application/octet-stream"
        }
        val length = file.length()
        val rangeHeader = request.requestHeaders.entries
            .firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value
        val range = parseByteRange(rangeHeader, length)
        val isHead = request.method.equals("HEAD", ignoreCase = true)

        if (rangeHeader != null && range == null) {
            return WebResourceResponse(
                mime,
                null,
                416,
                "Range Not Satisfiable",
                mapOf(
                    "Access-Control-Allow-Origin" to APP_ORIGIN,
                    "Content-Range" to "bytes */$length",
                    "Accept-Ranges" to "bytes",
                ),
                null,
            )
        }

        val (start, end) = range ?: (0L to (length - 1).coerceAtLeast(0))
        val responseLength = if (length > 0) end - start + 1 else 0
        val headers = linkedMapOf(
            "Access-Control-Allow-Origin" to APP_ORIGIN,
            "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers" to "Range, Origin, Accept, Content-Type",
            "Access-Control-Expose-Headers" to "Content-Length, Content-Range, Accept-Ranges",
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "private, max-age=31536000, immutable",
            "Content-Length" to responseLength.toString(),
        )
        if (range != null) headers["Content-Range"] = "bytes $start-$end/$length"

        val body: InputStream? = if (isHead || request.method.equals("OPTIONS", ignoreCase = true)) {
            null
        } else {
            val input = FileInputStream(file)
            input.channel.position(start)
            LimitedInputStream(input, responseLength)
        }

        return WebResourceResponse(
            mime,
            null,
            if (range != null) 206 else 200,
            if (range != null) "Partial Content" else "OK",
            headers,
            body,
        )
    }

    private fun parseByteRange(value: String?, length: Long): Pair<Long, Long>? {
        if (value.isNullOrBlank() || !value.startsWith("bytes=")) return null
        if (length <= 0) return null
        val raw = value.removePrefix("bytes=").substringBefore(',').trim()
        val parts = raw.split('-', limit = 2)
        if (parts.size != 2) return null
        val start = parts[0].toLongOrNull()
        val end = parts[1].toLongOrNull()
        return when {
            start != null -> {
                if (start >= length) null
                else start to minOf(end ?: (length - 1), length - 1)
            }
            end != null && end > 0 -> maxOf(0, length - end) to (length - 1)
            else -> null
        }
    }

    private class LimitedInputStream(
        private val source: InputStream,
        length: Long,
    ) : InputStream() {
        private var remaining = length

        override fun read(): Int {
            if (remaining <= 0) return -1
            val value = source.read()
            if (value >= 0) remaining -= 1
            return value
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0) return -1
            val allowed = minOf(length.toLong(), remaining).toInt()
            val count = source.read(buffer, offset, allowed)
            if (count > 0) remaining -= count
            return count
        }

        override fun close() = source.close()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (chrome.isFullscreen()) chrome.onHideCustomView()
        else if (web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    companion object {
        private const val APP_HOST = "easy-education.vercel.app"
        private const val APP_ORIGIN = "https://$APP_HOST"
    }
}
