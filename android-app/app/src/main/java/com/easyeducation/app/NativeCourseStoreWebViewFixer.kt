package com.easyeducation.app

import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import com.google.firebase.auth.FirebaseAuth
import java.util.WeakHashMap

/**
 * Installs the two course-store-only WebView fixes without changing the rest of the native app:
 *
 * 1) a main-frame network failure is stopped and the WebView is hidden, leaving the existing
 *    Compose offline/error card as the only visible error UI;
 * 2) the embedded store is bootstrapped through /login once so the existing production web auth
 *    flow receives a silent Google token for the account already active in native Firebase Auth.
 *
 * The existing V2AddCourse WebViewClient remains authoritative. We wrap and delegate to it rather
 * than replacing its enrollment/navigation behavior.
 */
object NativeCourseStoreWebViewFixer {
    private const val WEB_ORIGIN = "https://easy-education.vercel.app"
    private const val LOGIN_URL = "$WEB_ORIGIN/login"
    private const val USER_AGENT_MARKER = "EasyEducationAndroid/"

    private data class State(var authBootstrapStarted: Boolean = false)

    private val installed = WeakHashMap<WebView, State>()
    private val listeners = WeakHashMap<ComponentActivity, ViewTreeObserver.OnGlobalLayoutListener>()

    fun start(activity: ComponentActivity) {
        if (listeners.containsKey(activity)) return
        val root = activity.window.decorView
        lateinit var listener: ViewTreeObserver.OnGlobalLayoutListener
        listener = ViewTreeObserver.OnGlobalLayoutListener {
            installInTree(activity, root)
        }
        listeners[activity] = listener
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
        root.post { installInTree(activity, root) }
    }

    fun stop(activity: ComponentActivity) {
        val listener = listeners.remove(activity) ?: return
        val observer = activity.window.decorView.viewTreeObserver
        if (observer.isAlive) observer.removeOnGlobalLayoutListener(listener)
    }

    private fun installInTree(activity: ComponentActivity, view: View) {
        if (view is WebView && isCourseStore(view)) {
            install(activity, view)
            return
        }
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) installInTree(activity, view.getChildAt(index))
        }
    }

    private fun isCourseStore(webView: WebView): Boolean = runCatching {
        webView.settings.userAgentString.orEmpty().contains(USER_AGENT_MARKER)
    }.getOrDefault(false)

    private fun install(activity: ComponentActivity, webView: WebView) {
        if (installed.containsKey(webView)) return
        val state = State()
        installed[webView] = state

        NativeCourseStoreWebAuth.install(webView)
        val delegate = webView.webViewClient
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                delegate.onPageStarted(view, url, favicon)
                if (view != null && isAppUrl(url) && isOnline(activity)) {
                    view.visibility = View.VISIBLE
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                delegate.onPageFinished(view, url)
                val target = view ?: return
                if (!isAppUrl(url)) return

                target.evaluateJavascript(NativeCourseStoreWebAuth.pageScript(activity), null)
                val path = runCatching { Uri.parse(url.orEmpty()).path.orEmpty() }.getOrDefault("")

                // If V2AddCourse reached /courses before this wrapper was attached (or after the
                // device came back online), route through /login once to restore the web Firebase
                // session from the already-active native Google account.
                if (!state.authBootstrapStarted && path != "/login" &&
                    FirebaseAuth.getInstance().currentUser != null && isOnline(activity)
                ) {
                    state.authBootstrapStarted = true
                    target.loadUrl(LOGIN_URL)
                    return
                }
                if (path == "/login") state.authBootstrapStarted = true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                delegate.onReceivedError(view, request, error)
                val target = view ?: return
                if (request?.isForMainFrame != true || !isAppUrl(request.url?.toString())) return
                target.stopLoading()
                // V2AddCourse has its own branded Compose error/offline card. Hiding the failed
                // renderer prevents Chromium's default ERR_* page from appearing behind it.
                target.visibility = View.INVISIBLE
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                delegate.shouldOverrideUrlLoading(view, request)
        }

        // V2AddCourse normally begins at /courses. For an authenticated native user, bootstrap the
        // web Firebase session first. No chooser is shown: NativeCourseStoreWebAuth uses silentSignIn.
        if (FirebaseAuth.getInstance().currentUser != null && isOnline(activity)) {
            state.authBootstrapStarted = true
            webView.post { webView.loadUrl(LOGIN_URL) }
        }
    }

    private fun isAppUrl(value: String?): Boolean = runCatching {
        val uri = Uri.parse(value.orEmpty())
        uri.scheme == "https" && uri.host.equals("easy-education.vercel.app", ignoreCase = true)
    }.getOrDefault(false)

    private fun isOnline(activity: ComponentActivity): Boolean {
        val manager = activity.getSystemService(ConnectivityManager::class.java) ?: return false
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
