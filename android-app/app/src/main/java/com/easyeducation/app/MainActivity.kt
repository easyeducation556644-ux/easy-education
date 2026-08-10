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
                    val playlistUrl = request.getString("playlistUrl")
                    require(isAllowedMediaUrl(playlistUrl)) { "Unsupported media host" }
                    val existing = store.get(id)
                    store.save(DownloadTask(
                        id = id,
                        title = request.optString("title", "Class video"),
                        courseTitle = request.optString("courseTitle"),
                        playlistUrl = playlistUrl,
                        height = request.optInt("height", 360),
                        downloadedBytes = existing?.downloadedBytes ?: 0,
                        totalBytes = request.optLong("totalBytes"),
                        completed = existing?.completed ?: 0,
                        total = existing?.total ?: 0,
                    ))
                    HlsDownloadService.start(this, id)
                    JSONObject().put("ok", true).put("id", id)
                }
                "status" -> {
                    val id = request.getString("id")
                    val task = store.get(id) ?: error("Download not found")
                    val progress = if (task.total > 0) task.completed * 100 / task.total else 0
                    val byteProgress = if (task.totalBytes > 0)
                        task.downloadedBytes.toDouble() * 100.0 / task.totalBytes.toDouble()
                    else progress.toDouble()
                    JSONObject().put("ok", true).put("id", id).put("state", task.state)
                        .put("progress", byteProgress).put("completed", task.completed).put("total", task.total)
                        .put("downloadedBytes", task.downloadedBytes).put("totalBytes", task.totalBytes)
                        .put("height", task.height).put("title", task.title).put("courseTitle", task.courseTitle)
                        .put("error", task.error)
                        .put("playbackUrl", "https://native.easyeducation.local/${Uri.encode(id)}/playlist.m3u8")
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

    private fun isAllowedMediaUrl(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase() ?: return false
        URI(value).scheme == "https" && (host == "rumble.com" || host.endsWith(".rumble.com") ||
            host == "rumble.cloud" || host.endsWith(".rumble.cloud") ||
            host == "rmbl.ws" || host.endsWith(".rmbl.ws") ||
            host == "1a-1791.com" || host.endsWith(".1a-1791.com"))
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
            if (parts.size < 2) return null
            val file = File(filesDir, "offline/${HlsDownloadService.safe(parts[0])}/${parts.drop(1).joinToString("/")}")
            if (!file.exists()) return WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), null)

            val mime = when (file.extension.lowercase()) {
                "m3u8" -> "application/vnd.apple.mpegurl"
                "m4s", "mp4" -> "video/mp4"
                else -> "video/mp2t"
            }
            val headers = mapOf(
                "Access-Control-Allow-Origin" to APP_ORIGIN,
                "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers" to "Range, Origin, Accept, Content-Type",
                "Accept-Ranges" to "bytes",
                "Cache-Control" to "no-store",
                "Content-Length" to file.length().toString(),
            )
            return WebResourceResponse(mime, null, 200, "OK", headers, FileInputStream(file))
        }
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
