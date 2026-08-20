package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import java.net.URI

/**
 * Rumble playback intentionally uses Rumble's own embed runtime instead of extracting temporary
 * CDN URLs. Rumble rotates/signs its media requests independently; the official embed is therefore
 * the stable playback surface while downloads can continue using the authenticated backend path.
 */
@Composable
fun RumbleEmbedPlayer(
    sourceUrl: String,
    online: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivityForRumble() }
    val embedUrl = remember(sourceUrl) { rumbleEmbedUrl(sourceUrl) }
    var loading by remember(sourceUrl) { mutableStateOf(embedUrl != null && online) }
    var errorText by remember(sourceUrl, online) { mutableStateOf<String?>(null) }
    var webView by remember(sourceUrl) { mutableStateOf<WebView?>(null) }
    var chromeClient by remember(sourceUrl) { mutableStateOf<RumbleFullscreenChromeClient?>(null) }

    DisposableEffect(sourceUrl) {
        PersistentNativePlayer.pause()
        onDispose {
            chromeClient?.closeFullscreen()
            webView?.apply {
                stopLoading()
                loadUrl("about:blank")
                removeAllViews()
                destroy()
            }
            webView = null
            chromeClient = null
        }
    }

    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .background(ComposeColor.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (online && embedUrl != null && activity != null) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        setBackgroundColor(Color.BLACK)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.mediaPlaybackRequiresUserGesture = false
                        settings.loadsImagesAutomatically = true
                        settings.useWideViewPort = true
                        settings.loadWithOverviewMode = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        val cookieManager = CookieManager.getInstance()
                        cookieManager.setAcceptCookie(true)
                        cookieManager.setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView?, url: String?) {
                                loading = false
                                errorText = null
                            }

                            override fun onReceivedError(
                                view: WebView?,
                                request: WebResourceRequest?,
                                error: WebResourceError?,
                            ) {
                                if (request?.isForMainFrame == true) {
                                    loading = false
                                    errorText = "Rumble video could not be loaded. Check your connection and try again."
                                }
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?,
                            ): Boolean {
                                val target = request?.url ?: return true
                                val host = target.host?.lowercase().orEmpty()
                                return if (host == "rumble.com" || host.endsWith(".rumble.com")) {
                                    false
                                } else {
                                    // Never hand Rumble playback/navigation to an external browser.
                                    true
                                }
                            }
                        }
                        val chrome = RumbleFullscreenChromeClient(activity)
                        webChromeClient = chrome
                        chromeClient = chrome
                        webView = this
                        loadUrl(embedUrl)
                    }
                },
            )
        }

        when {
            !online -> Text(
                "No internet • downloaded classes are available from Downloads",
                color = ComposeColor.White,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(20.dp),
            )
            embedUrl == null -> Text(
                "This Rumble video link is invalid.",
                color = ComposeColor.White,
                modifier = Modifier.padding(20.dp),
            )
            activity == null -> Text(
                "Rumble player could not start on this device.",
                color = ComposeColor.White,
                modifier = Modifier.padding(20.dp),
            )
            loading -> CircularProgressIndicator()
            errorText != null -> Text(
                errorText.orEmpty(),
                color = ComposeColor.White,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(20.dp),
            )
        }
    }
}

fun isRumbleVideoUrl(value: String): Boolean = runCatching {
    val host = URI(value).host?.lowercase().orEmpty()
    host == "rumble.com" || host.endsWith(".rumble.com")
}.getOrDefault(false)

private fun rumbleEmbedUrl(sourceUrl: String): String? {
    if (!isRumbleVideoUrl(sourceUrl)) return null
    val parsed = runCatching { Uri.parse(sourceUrl) }.getOrNull() ?: return null
    val id = parsed.pathSegments
        .asSequence()
        .mapNotNull { segment ->
            Regex("^(v[0-9A-Za-z]+)", RegexOption.IGNORE_CASE)
                .find(segment)
                ?.groupValues
                ?.getOrNull(1)
        }
        .firstOrNull()
        ?: return null
    return "https://rumble.com/embed/$id/"
}

private class RumbleFullscreenChromeClient(
    private val activity: Activity,
) : WebChromeClient() {
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenContainer: FrameLayout? = null
    private var previousSystemUiVisibility: Int = 0

    override fun onShowCustomView(view: View?, callback: WebChromeClient.CustomViewCallback?) {
        if (view == null) {
            callback?.onCustomViewHidden()
            return
        }
        if (customView != null) {
            callback?.onCustomViewHidden()
            return
        }
        val decor = activity.window.decorView as? ViewGroup ?: run {
            callback?.onCustomViewHidden()
            return
        }
        previousSystemUiVisibility = activity.window.decorView.systemUiVisibility
        val container = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        decor.addView(
            container,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        customView = view
        customViewCallback = callback
        fullscreenContainer = container
        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onHideCustomView() {
        closeFullscreen()
    }

    fun closeFullscreen() {
        val container = fullscreenContainer ?: return
        (container.parent as? ViewGroup)?.removeView(container)
        customViewCallback?.onCustomViewHidden()
        customView = null
        customViewCallback = null
        fullscreenContainer = null
        @Suppress("DEPRECATION")
        runCatching { activity.window.decorView.systemUiVisibility = previousSystemUiVisibility }
    }
}

private fun Context.findActivityForRumble(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return current as? Activity
}
