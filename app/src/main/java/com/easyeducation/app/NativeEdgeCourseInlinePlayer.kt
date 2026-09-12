package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

object NativeEdgeCourseWebSupport {
    fun requiresWebView(raw: String): Boolean {
        val value = raw.trim()
        if (value.isBlank()) return false
        val lower = value.lowercase()
        if (YoutubeDeviceResolver.isYoutubeUrl(value)) return false
        if (lower.contains(".m3u8") || Regex("\\.(mp4|webm|ogg|mov)(?:[?#].*)?$", RegexOption.IGNORE_CASE).containsMatchIn(value)) return false
        val host = runCatching { Uri.parse(value).host.orEmpty().lowercase() }.getOrDefault("")
        if (host == "rumble.com" || host.endsWith(".rumble.com")) return false
        return true
    }
}

private class EdgeInlineChromeClient(
    private val activity: Activity,
    private val onFullscreenChanged: (Boolean) -> Unit,
) : WebChromeClient() {
    private var customView: View? = null
    private var callback: CustomViewCallback? = null
    private var parent: ViewGroup? = null
    private var orientationBefore = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    val fullscreen: Boolean get() = customView != null

    override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        if (view == null || customView != null) {
            callback?.onCustomViewHidden()
            return
        }
        customView = view
        this.callback = callback
        orientationBefore = activity.requestedOrientation
        val decor = activity.window.decorView as ViewGroup
        parent = decor
        (view.parent as? ViewGroup)?.removeView(view)
        decor.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.bringToFront()
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        onFullscreenChanged(true)
    }

    override fun onHideCustomView() = hide()

    fun hide() {
        val view = customView ?: return
        parent?.removeView(view)
        parent = null
        customView = null
        callback?.onCustomViewHidden()
        callback = null
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            .show(WindowInsetsCompat.Type.systemBars())
        WindowCompat.setDecorFitsSystemWindows(activity.window, true)
        activity.requestedOrientation = orientationBefore
        onFullscreenChanged(false)
    }
}

@Composable
fun NativeEdgeCourseInlinePlayer(
    sourceUrl: String,
    edgeCourseId: String,
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = remember(context) { context.edgeActivity() }
    var fullscreen by remember(sourceUrl) { mutableStateOf(false) }
    val chrome = remember(sourceUrl, activity) {
        activity?.let { EdgeInlineChromeClient(it) { fullscreen = it } }
    }
    var webView by remember(sourceUrl) { mutableStateOf<WebView?>(null) }

    BackHandler(enabled = fullscreen) { chrome?.hide() }

    DisposableEffect(sourceUrl) {
        onDispose {
            chrome?.hide()
            webView?.apply {
                stopLoading()
                loadUrl("about:blank")
                removeAllViews()
                destroy()
            }
            webView = null
        }
    }

    Box(
        modifier = modifier.fillMaxWidth().background(ComposeColor.Black),
        contentAlignment = Alignment.Center,
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    webView = this
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
                    if (chrome != null) webChromeClient = chrome
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val scheme = request.url.scheme.orEmpty().lowercase()
                            return scheme != "http" && scheme != "https"
                        }
                    }
                    val coursePage = "https://edgecoursebd.com/courses/${Uri.encode(edgeCourseId)}"
                    loadDataWithBaseURL(
                        coursePage,
                        edgeEmbedHtml(edgeEmbedUrl(sourceUrl)),
                        "text/html",
                        "utf-8",
                        null,
                    )
                }
            },
            update = { view ->
                view.contentDescription = title
            },
        )
        if (!fullscreen) {
            Surface(
                modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.55f),
            ) {
                IconButton(onClick = onBack, modifier = Modifier.size(42.dp)) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = ComposeColor.White,
                    )
                }
            }
        }
    }
}

private fun Context.edgeActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.edgeActivity()
    else -> null
}

private fun edgeEmbedUrl(raw: String): String {
    val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return raw
    val host = uri.host.orEmpty().lowercase()
    if (host.contains("vimeo.com")) {
        if (host.contains("player.vimeo.com") && uri.path.orEmpty().contains("/video/")) return raw
        val id = uri.pathSegments.firstOrNull { it.matches(Regex("\\d+")) }
        if (!id.isNullOrBlank()) {
            val hash = uri.getQueryParameter("h").orEmpty().ifBlank { uri.getQueryParameter("hash").orEmpty() }
            return buildString {
                append("https://player.vimeo.com/video/").append(id)
                append("?title=0&byline=0&portrait=0&playsinline=1&autoplay=1")
                if (hash.isNotBlank()) append("&h=").append(Uri.encode(hash))
            }
        }
    }
    if (host.endsWith("drive.google.com")) {
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
    if (host.contains("facebook.com") || host == "fb.watch") {
        return "https://www.facebook.com/plugins/video.php?href=${Uri.encode(raw)}&show_text=false&width=1280"
    }
    if (host.contains("streamyard.com")) {
        val id = uri.pathSegments.lastOrNull().orEmpty()
        if (id.isNotBlank()) return "https://streamyard.com/watch/${Uri.encode(id)}?embed=true"
    }
    return raw
}

private fun edgeEmbedHtml(source: String): String {
    val escaped = source
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    return """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
        <meta name="referrer" content="strict-origin-when-cross-origin">
        <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#000}</style>
        </head><body><iframe src="$escaped" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>
    """.trimIndent()
}
