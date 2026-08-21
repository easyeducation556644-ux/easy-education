package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatImageButton
import com.google.firebase.auth.FirebaseAuth

/**
 * In-app-only presentation for CPS live sessions. YouTube lives stay inside an isolated iframe;
 * title/channel navigation, popup windows and top-level external navigation are blocked. Recorded
 * lives are deliberately handed to the normal native player instead of a browser/WebView.
 */
class NativeCpsLivePlayerActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var initialDirectUrl: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)

        val rawUrl = intent.getStringExtra(EXTRA_URL).orEmpty().trim()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "CPS Live Class" }
        if (rawUrl.isBlank()) {
            Toast.makeText(this, "Live stream is not available yet.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(5), dp(12), dp(5))
            setBackgroundColor(Color.rgb(12, 12, 12))
        }
        val back = AppCompatImageButton(this).apply {
            setImageResource(R.drawable.ic_player_back)
            contentDescription = "Back"
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            setOnClickListener { finish() }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(TextView(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 16f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        root.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val stage = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            isLongClickable = false
            setOnLongClickListener { true }
            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean = false
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    if (request.isForMainFrame) {
                        // Never let an iframe click replace our app page or launch a browser surface.
                        return target.toString() != initialDirectUrl
                    }
                    val host = target.host.orEmpty().lowercase()
                    val path = target.path.orEmpty().lowercase()
                    val youtubeFrame = (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) && path.startsWith("/embed/")
                    return (host.contains("youtube") || host.contains("youtu.be")) && !youtubeFrame
                }
            }
        }
        stage.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val youtubeId = youtubeVideoId(rawUrl)
        if (youtubeId != null) {
            // The overlay intentionally covers YouTube's title/channel hotspot. Playback controls
            // remain available below it, and clicks cannot navigate outside the embedded player.
            stage.addView(View(this).apply { setBackgroundColor(Color.BLACK) }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46), Gravity.TOP))
            val embed = "https://www.youtube-nocookie.com/embed/$youtubeId?autoplay=1&playsinline=1&rel=0&iv_load_policy=3&controls=1&fs=1"
            val html = """
                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
                <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
                <body><iframe src="$embed" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>
            """.trimIndent()
            webView.loadDataWithBaseURL("https://www.youtube-nocookie.com", html, "text/html", "utf-8", null)
        } else {
            val uri = runCatching { Uri.parse(rawUrl) }.getOrNull()
            if (uri?.scheme?.lowercase() !in setOf("http", "https")) {
                Toast.makeText(this, "This live source is not supported.", Toast.LENGTH_LONG).show()
                finish()
                return
            }
            initialDirectUrl = rawUrl
            webView.loadUrl(rawUrl)
        }
        root.addView(stage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.removeAllViews()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val EXTRA_URL = "cps_live_url"
        private const val EXTRA_TITLE = "cps_live_title"

        fun openLive(context: Context, title: String, url: String, id: String) {
            if (url.isBlank()) return
            val lower = url.lowercase()
            val directNative = lower.contains(".m3u8") || lower.contains(".mp4") || lower.contains("rumble.com")
            if (directNative && youtubeVideoId(url) == null) {
                context.startActivity(
                    Intent(context, NativePlayerActivity::class.java)
                        .putExtra(NativePlayerActivity.EXTRA_TITLE, title)
                        .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, "cps-live:$id")
                        .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, url)
                        .putExtra(NativePlayerActivity.EXTRA_HEIGHT, 720),
                )
                return
            }
            context.startActivity(Intent(context, NativeCpsLivePlayerActivity::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_URL, url))
        }

        fun openRecording(context: Context, title: String, url: String, id: String, startPositionMs: Long = 0L) {
            if (url.isBlank()) return
            context.startActivity(
                Intent(context, NativePlayerActivity::class.java)
                    .putExtra(NativePlayerActivity.EXTRA_TITLE, title)
                    .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, "cps-recording:$id")
                    .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, url)
                    .putExtra(NativePlayerActivity.EXTRA_HEIGHT, 720)
                    .putExtra(NativePlayerActivity.EXTRA_START_POSITION_MS, startPositionMs),
            )
        }

        private fun youtubeVideoId(raw: String): String? {
            val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return null
            val host = uri.host.orEmpty().lowercase().removePrefix("www.").removePrefix("m.")
            val candidate = when {
                host == "youtu.be" -> uri.pathSegments.firstOrNull()
                host.endsWith("youtube.com") -> when {
                    uri.pathSegments.firstOrNull() == "watch" -> uri.getQueryParameter("v")
                    uri.pathSegments.firstOrNull() in setOf("live", "embed", "shorts") -> uri.pathSegments.getOrNull(1)
                    else -> uri.getQueryParameter("v")
                }
                else -> null
            }?.trim().orEmpty()
            return candidate.takeIf { it.matches(Regex("[A-Za-z0-9_-]{6,}")) }
        }
    }
}
