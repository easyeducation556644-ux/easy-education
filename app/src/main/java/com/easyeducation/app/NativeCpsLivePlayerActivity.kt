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

/**
 * Dedicated CPS live player.
 *
 * Live playback deliberately does not use the recorded-video resolver. YouTube live sessions are
 * rendered in an iframe with an app origin/referrer so YouTube can validate the embedded player.
 * Other HTTP(S) live providers stay inside this WebView; direct MP4/HLS URLs are hosted in an HTML5
 * video element. A YouTube live also exposes an explicit external Watch on YouTube action.
 */
class NativeCpsLivePlayerActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var stage: FrameLayout
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenParent: ViewGroup? = null
    private var orientationBeforeFullscreen: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)

        val rawUrl = intent.getStringExtra(EXTRA_URL).orEmpty().trim()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "CPS Live Class" }
        if (!isHttpUrl(rawUrl)) {
            Toast.makeText(this, "Live stream is not available yet.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val youtubeId = youtubeVideoId(rawUrl)
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

        stage = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            isLongClickable = false
            setOnLongClickListener { true }

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView?,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: android.os.Message?,
                ): Boolean = false

                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null || customView != null) {
                        callback?.onCustomViewHidden()
                        return
                    }

                    customView = view
                    customViewCallback = callback
                    orientationBeforeFullscreen = requestedOrientation

                    // WebView's fullscreen view must sit over the whole Activity decor, not inside
                    // the normal player stage. Otherwise the header / YouTube button still reserve
                    // space and the iframe never becomes true device fullscreen.
                    val decor = window.decorView as ViewGroup
                    fullscreenParent = decor
                    (view.parent as? ViewGroup)?.removeView(view)
                    decor.addView(
                        view,
                        ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    view.bringToFront()

                    // A live class is video-first: the iframe fullscreen action should immediately
                    // rotate to landscape, exactly like a normal video player fullscreen action.
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    enterImmersiveFullscreen()
                }

                override fun onHideCustomView() {
                    hideCustomView()
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    val scheme = target.scheme.orEmpty().lowercase()
                    if (scheme !in setOf("http", "https")) return true

                    if (youtubeId != null && request.isForMainFrame) {
                        val host = target.host.orEmpty().lowercase()
                        val path = target.path.orEmpty().lowercase()
                        val isEmbed = (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) && path.startsWith("/embed/")
                        return !isEmbed
                    }
                    return false
                }
            }
        }
        stage.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(stage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        if (youtubeId != null) {
            val youtubeUrl = "https://www.youtube.com/watch?v=$youtubeId"
            val button = TextView(this).apply {
                text = "Watch on YouTube If you want :)"
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(30, 30, 30))
                textSize = 15f
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(13), dp(14), dp(13))
                setOnClickListener {
                    runCatching {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(youtubeUrl)))
                    }.onFailure {
                        Toast.makeText(this@NativeCpsLivePlayerActivity, "Could not open YouTube.", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            root.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            loadYoutubeIframe(youtubeId)
        } else if (isDirectMedia(rawUrl)) {
            loadDirectMediaPage(rawUrl)
        } else {
            webView.loadUrl(rawUrl, mapOf("Referer" to APP_ORIGIN))
        }

        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) hideCustomView() else finish()
            }
        })
    }

    private fun loadYoutubeIframe(videoId: String) {
        val embed = "https://www.youtube.com/embed/$videoId?autoplay=1&playsinline=1&rel=0&controls=1&fs=1&enablejsapi=1&origin=${Uri.encode(APP_ORIGIN.removeSuffix("/"))}"
        val html = """
            <!doctype html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
              <meta name="referrer" content="strict-origin-when-cross-origin">
              <style>
                html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
                #player{position:fixed;inset:0;width:100%;height:100%;border:0;background:#000}
              </style>
            </head>
            <body>
              <iframe id="player"
                src="$embed"
                title="CPS Live Class"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen></iframe>
            </body>
            </html>
        """.trimIndent()
        webView.loadDataWithBaseURL(APP_ORIGIN, html, "text/html", "utf-8", null)
    }

    private fun loadDirectMediaPage(url: String) {
        val escaped = htmlEscape(url)
        val html = """
            <!doctype html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
              <style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}</style>
            </head>
            <body><video src="$escaped" controls autoplay playsinline></video></body>
            </html>
        """.trimIndent()
        webView.loadDataWithBaseURL(APP_ORIGIN, html, "text/html", "utf-8", null)
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
        private const val EXTRA_URL = "cps_live_url"
        private const val EXTRA_TITLE = "cps_live_title"
        private const val APP_ORIGIN = "https://easy-education.vercel.app/"

        fun openLive(context: Context, title: String, url: String, id: String) {
            if (!isHttpUrl(url)) return
            context.startActivity(
                Intent(context, NativeCpsLivePlayerActivity::class.java)
                    .putExtra(EXTRA_TITLE, title)
                    .putExtra(EXTRA_URL, url)
                    .putExtra("cps_live_id", id),
            )
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

        private fun isHttpUrl(raw: String): Boolean {
            val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return false
            return uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank()
        }

        private fun isDirectMedia(raw: String): Boolean {
            val path = runCatching { Uri.parse(raw).path.orEmpty().lowercase() }.getOrDefault("")
            return path.endsWith(".m3u8") || path.endsWith(".mp4") || path.endsWith(".webm")
        }

        private fun htmlEscape(value: String): String = value
            .replace("&", "&amp;")
            .replace("\"", "&quot;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")

        private fun youtubeVideoId(raw: String): String? {
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
    }
}
