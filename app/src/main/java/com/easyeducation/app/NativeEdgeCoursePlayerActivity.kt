package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatImageButton
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.firebase.auth.FirebaseAuth

/** EdgeCourse video shell. Keeps EdgeCourse as the referrer/origin so privacy-bound embeds (notably Vimeo) have the best chance to play. */
class NativeEdgeCoursePlayerActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenParent: ViewGroup? = null
    private var orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)

        val rawUrl = intent.getStringExtra(EXTRA_URL).orEmpty().trim()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "EdgeCourse class" }
        val courseId = intent.getStringExtra(EXTRA_COURSE_ID).orEmpty().trim()
        if (!isHttpUrl(rawUrl)) {
            Toast.makeText(this, "This EdgeCourse video link cannot be opened.", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        val coursePage = if (courseId.isNotBlank()) "$EDGE_SITE/courses/${Uri.encode(courseId)}" else "$EDGE_SITE/"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(5), dp(10), dp(5))
            setBackgroundColor(Color.rgb(14, 14, 14))
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
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            isLongClickable = false
            setOnLongClickListener { true }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null || customView != null) {
                        callback?.onCustomViewHidden()
                        return
                    }
                    customView = view
                    customViewCallback = callback
                    orientationBeforeFullscreen = requestedOrientation
                    val decor = window.decorView as ViewGroup
                    fullscreenParent = decor
                    (view.parent as? ViewGroup)?.removeView(view)
                    decor.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    view.bringToFront()
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    enterImmersiveFullscreen()
                }

                override fun onHideCustomView() = hideCustomView()
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val scheme = request.url.scheme.orEmpty().lowercase()
                    return scheme != "http" && scheme != "https"
                }
            }
        }
        stage.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(stage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        if (isVimeoUrl(rawUrl)) {
            root.addView(TextView(this).apply {
                text = "Vimeo blocked? Try EdgeCourse original player"
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(30, 30, 30))
                textSize = 14f
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(12), dp(12), dp(12))
                setOnClickListener { webView.loadUrl(coursePage, mapOf("Referer" to coursePage)) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }

        setContentView(root)
        loadSource(rawUrl, coursePage)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> hideCustomView()
                    webView.canGoBack() -> webView.goBack()
                    else -> finish()
                }
            }
        })
    }

    private fun loadSource(rawUrl: String, coursePage: String) {
        val youtubeId = youtubeId(rawUrl)
        when {
            youtubeId != null -> loadFrame(
                "https://www.youtube-nocookie.com/embed/$youtubeId?rel=0&playsinline=1&fs=1&autoplay=1&origin=${Uri.encode(EDGE_SITE)}",
                coursePage,
            )
            isVimeoUrl(rawUrl) -> loadFrame(vimeoEmbed(rawUrl), coursePage)
            isGoogleDriveUrl(rawUrl) -> loadFrame(googleDriveEmbed(rawUrl), coursePage)
            isFacebookUrl(rawUrl) -> loadFrame("https://www.facebook.com/plugins/video.php?href=${Uri.encode(rawUrl)}&show_text=false&width=1280", coursePage)
            isStreamyardUrl(rawUrl) -> loadFrame(streamyardEmbed(rawUrl), coursePage)
            isDirectMedia(rawUrl) -> loadVideo(rawUrl, coursePage)
            else -> webView.loadUrl(rawUrl, mapOf("Referer" to coursePage))
        }
    }

    private fun loadFrame(source: String, baseUrl: String) {
        val escaped = htmlEscape(source)
        val html = """
            <!doctype html><html><head>
            <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
            <meta name="referrer" content="strict-origin-when-cross-origin">
            <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#000}</style>
            </head><body><iframe src="$escaped" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
    }

    private fun loadVideo(source: String, baseUrl: String) {
        val escaped = htmlEscape(source)
        val html = """
            <!doctype html><html><head>
            <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
            <meta name="referrer" content="strict-origin-when-cross-origin">
            <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{width:100%;height:100%;object-fit:contain;background:#000}</style>
            </head><body><video src="$escaped" controls autoplay playsinline></video></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
    }

    private fun enterImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun leaveImmersiveFullscreen() {
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        WindowCompat.setDecorFitsSystemWindows(window, true)
    }

    private fun hideCustomView() {
        val view = customView ?: return
        fullscreenParent?.removeView(view)
        fullscreenParent = null
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        leaveImmersiveFullscreen()
        requestedOrientation = orientationBeforeFullscreen
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        if (customView != null) enterImmersiveFullscreen()
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (customView != null) hideCustomView()
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
        private const val EXTRA_URL = "edgecourse_url"
        private const val EXTRA_TITLE = "edgecourse_title"
        private const val EXTRA_COURSE_ID = "edgecourse_course_id"
        private const val EDGE_SITE = "https://edgecoursebd.com"

        fun open(context: Context, courseId: String, title: String, url: String) {
            if (!isHttpUrl(url)) return
            context.startActivity(
                Intent(context, NativeEdgeCoursePlayerActivity::class.java)
                    .putExtra(EXTRA_COURSE_ID, courseId)
                    .putExtra(EXTRA_TITLE, title)
                    .putExtra(EXTRA_URL, url),
            )
        }

        private fun isHttpUrl(raw: String): Boolean {
            val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return false
            return uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank()
        }

        private fun youtubeId(raw: String): String? {
            val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return null
            val host = uri.host.orEmpty().lowercase().removePrefix("www.").removePrefix("m.")
            val candidate = when {
                host == "youtu.be" -> uri.pathSegments.firstOrNull()
                host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com") -> when {
                    uri.pathSegments.firstOrNull() == "watch" -> uri.getQueryParameter("v")
                    uri.pathSegments.firstOrNull() in setOf("live", "embed", "shorts") -> uri.pathSegments.getOrNull(1)
                    else -> uri.getQueryParameter("v")
                }
                else -> null
            }?.trim().orEmpty()
            return candidate.takeIf { it.matches(Regex("[A-Za-z0-9_-]{6,}")) }
        }

        private fun isVimeoUrl(raw: String): Boolean = runCatching {
            Uri.parse(raw).host.orEmpty().lowercase().contains("vimeo.com")
        }.getOrDefault(false)

        private fun vimeoEmbed(raw: String): String {
            val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return raw
            if (uri.host.orEmpty().contains("player.vimeo.com") && uri.path.orEmpty().contains("/video/")) return raw
            val id = uri.pathSegments.firstOrNull { it.matches(Regex("\\d+")) } ?: return raw
            val hash = uri.getQueryParameter("h").orEmpty().ifBlank { uri.getQueryParameter("hash").orEmpty() }
            return buildString {
                append("https://player.vimeo.com/video/").append(id).append("?title=0&byline=0&portrait=0&playsinline=1")
                if (hash.isNotBlank()) append("&h=").append(Uri.encode(hash))
            }
        }

        private fun isGoogleDriveUrl(raw: String): Boolean = runCatching {
            Uri.parse(raw).host.orEmpty().lowercase().endsWith("drive.google.com")
        }.getOrDefault(false)

        private fun googleDriveEmbed(raw: String): String {
            val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return raw
            val parts = uri.pathSegments
            val d = parts.indexOf("d")
            val folders = parts.indexOf("folders")
            val fileId = if (d >= 0) parts.getOrNull(d + 1) else uri.getQueryParameter("id")
            val folderId = if (folders >= 0) parts.getOrNull(folders + 1) else null
            return when {
                !fileId.isNullOrBlank() -> "https://drive.google.com/file/d/${Uri.encode(fileId)}/preview"
                !folderId.isNullOrBlank() -> "https://drive.google.com/embeddedfolderview?id=${Uri.encode(folderId)}#grid"
                else -> raw
            }
        }

        private fun isFacebookUrl(raw: String): Boolean = runCatching {
            val host = Uri.parse(raw).host.orEmpty().lowercase()
            host.contains("facebook.com") || host == "fb.watch"
        }.getOrDefault(false)

        private fun isStreamyardUrl(raw: String): Boolean = runCatching {
            Uri.parse(raw).host.orEmpty().lowercase().contains("streamyard.com")
        }.getOrDefault(false)

        private fun streamyardEmbed(raw: String): String {
            val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return raw
            val id = uri.pathSegments.lastOrNull().orEmpty()
            return if (id.isBlank()) raw else "https://streamyard.com/watch/${Uri.encode(id)}?embed=true"
        }

        private fun isDirectMedia(raw: String): Boolean {
            val value = raw.lowercase()
            return Regex("\\.(m3u8|mp4|webm|ogg|mov)(?:[?#].*)?$").containsMatchIn(value) ||
                value.contains("iframe.mediadelivery.net/embed/") || value.contains("player.mediadelivery.net/")
        }

        private fun htmlEscape(value: String): String = value
            .replace("&", "&amp;")
            .replace("\"", "&quot;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    }
}
