package com.easyeducation.app

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject

/**
 * Gives only the course-store login page a temporary bridge compatible with the existing
 * web nativeRequest("googleSignIn") flow. The bridge silently refreshes the already selected
 * Google account and never opens an account chooser, so the WebView signs into the exact account
 * that is active in the native Firebase session.
 */
object NativeCourseStoreWebAuth {
    const val JS_OBJECT = "EasyEducationCourseAuth"
    private const val WEB_ORIGIN = "https://easy-education.vercel.app"

    fun install(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(
            webView,
            JS_OBJECT,
            setOf(WEB_ORIGIN),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy,
                ) {
                    if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != WEB_ORIGIN) return
                    val payload = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull() ?: return
                    val requestId = payload.optString("requestId")
                    if (requestId.isBlank()) return
                    if (payload.optString("action") != "googleSignIn") {
                        replyProxy.postMessage(errorReply(requestId, "Unsupported course-store native request"))
                        return
                    }
                    replyGoogleToken(view, requestId, replyProxy)
                }
            },
        )
    }

    private fun replyGoogleToken(
        webView: WebView,
        requestId: String,
        replyProxy: JavaScriptReplyProxy,
    ) {
        val nativeUser = FirebaseAuth.getInstance().currentUser
        if (nativeUser == null) {
            replyProxy.postMessage(errorReply(requestId, "Native session is signed out"))
            return
        }
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(webView.context.getString(R.string.default_web_client_id))
            .requestEmail()
            .build()
        val client = GoogleSignIn.getClient(webView.context, options)
        client.silentSignIn()
            .addOnSuccessListener { account ->
                val nativeEmail = nativeUser.email.orEmpty()
                val googleEmail = account.email.orEmpty()
                if (nativeEmail.isNotBlank() && googleEmail.isNotBlank() &&
                    !nativeEmail.equals(googleEmail, ignoreCase = true)
                ) {
                    replyProxy.postMessage(errorReply(requestId, "Google account does not match the native session"))
                    return@addOnSuccessListener
                }
                val idToken = account.idToken
                if (idToken.isNullOrBlank()) {
                    replyProxy.postMessage(errorReply(requestId, "Google session token is unavailable"))
                    return@addOnSuccessListener
                }
                replyProxy.postMessage(
                    JSONObject()
                        .put("requestId", requestId)
                        .put("ok", true)
                        .put("idToken", idToken)
                        .toString(),
                )
            }
            .addOnFailureListener { error ->
                replyProxy.postMessage(
                    errorReply(requestId, error.message ?: "Could not refresh the native Google session"),
                )
            }
    }

    /**
     * The production web login already knows how to consume nativeRequest("googleSignIn"). We only
     * alias our narrow bridge while /login is visible, click that existing button once, then restore
     * the course-store bridge after auth completes. Seeding deviceID makes the web device check
     * update the same native device record instead of treating the embedded WebView as a second phone.
     */
    fun pageScript(context: android.content.Context): String {
        val deviceId = JSONObject.quote(NativeDeviceSession.deviceId(context))
        return """
            (function () {
              try { localStorage.setItem('deviceID', $deviceId); } catch (_) {}
              if (window.__easyEducationCourseAuthTimer) return;
              function restoreStoreBridge() {
                if (!window.__easyEducationCourseStoreBridge) return;
                try { window.EasyEducationNative = window.__easyEducationCourseStoreBridge; } catch (_) {}
              }
              function tick() {
                var path = window.location.pathname || '';
                if (path === '/login') {
                  try { sessionStorage.setItem('__easyEducationCourseStoreReturn', '1'); } catch (_) {}
                  if (window.__easyEducationCourseAuthStarted) return;
                  var bridge = window.$JS_OBJECT;
                  if (!bridge || typeof bridge.postMessage !== 'function') return;
                  var button = Array.prototype.find.call(
                    document.querySelectorAll('button'),
                    function (item) { return /sign\s*in\s*with\s*google/i.test(item.textContent || ''); }
                  );
                  if (!button) return;
                  if (!window.__easyEducationCourseStoreBridge) {
                    window.__easyEducationCourseStoreBridge = window.EasyEducationNative;
                  }
                  window.__easyEducationCourseAuthStarted = true;
                  try { window.EasyEducationNative = bridge; } catch (_) { return; }
                  button.click();
                  return;
                }
                restoreStoreBridge();
                var shouldReturn = false;
                try { shouldReturn = sessionStorage.getItem('__easyEducationCourseStoreReturn') === '1'; } catch (_) {}
                if (shouldReturn && (path === '/dashboard' || path === '/')) {
                  try { sessionStorage.removeItem('__easyEducationCourseStoreReturn'); } catch (_) {}
                  window.location.replace('/courses');
                }
              }
              tick();
              window.__easyEducationCourseAuthTimer = window.setInterval(tick, 250);
            })();
        """.trimIndent()
    }

    private fun errorReply(requestId: String, message: String): String =
        JSONObject()
            .put("requestId", requestId)
            .put("ok", false)
            .put("error", message)
            .toString()
}
