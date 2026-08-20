package com.easyeducation.app

import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class RumbleFixingWebViewClient(
    private val delegate: WebViewClient,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        delegate.shouldOverrideUrlLoading(view, request)

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        delegate.onReceivedError(view, request, error)
    }

    override fun onPageCommitVisible(view: WebView?, url: String?) {
        delegate.onPageCommitVisible(view, url)
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        originalRumbleUrl(request.url)?.let { videoUrl ->
            view?.let { coordinator.resolveAndPatch(it, videoUrl) }
        }
        return delegate.shouldInterceptRequest(view, request)
    }

    private fun originalRumbleUrl(uri: Uri): String? {
        if (uri.scheme != "https" || uri.host != APP_HOST) return null
        val videoUrl = when {
            uri.path == "/api/offline-video" && uri.getQueryParameter("options") == "1" ->
                uri.getQueryParameter("videoUrl")
            uri.path == "/api/version" && uri.getQueryParameter("resource") == "rumble-embed" ->
                uri.getQueryParameter("videoUrl")
            else -> null
        }?.trim().orEmpty()
        return videoUrl.takeIf { rumbleWatchId(it) != null }
    }

    companion object {
        private const val APP_HOST = "easy-education.vercel.app"
        private val coordinator = RumblePatchCoordinator()

        internal fun rumbleWatchId(value: String): String? = runCatching {
            val uri = URI(value)
            val host = uri.host?.lowercase() ?: return null
            if (uri.scheme != "https") return null
            if (host != "rumble.com" && !host.endsWith(".rumble.com")) return null
            val segments = uri.path.split('/').filter { it.isNotBlank() }
            val candidate = if (segments.firstOrNull().equals("embed", ignoreCase = true)) {
                segments.getOrNull(1)?.substringBefore('.')
            } else {
                segments.firstOrNull()?.substringBefore('-')?.substringBefore('.')
            }.orEmpty()
            candidate.takeIf { it.matches(Regex("^v[a-zA-Z0-9]+$")) }
        }.getOrNull()
    }
}

private class RumblePatchCoordinator {
    private val executor = Executors.newSingleThreadExecutor()
    private val resolver = RumbleEmbedResolver()
    private val cache = ConcurrentHashMap<String, String>()
    private val inFlight = ConcurrentHashMap.newKeySet<String>()

    fun resolveAndPatch(view: WebView, videoUrl: String) {
        val expectedId = RumbleFixingWebViewClient.rumbleWatchId(videoUrl) ?: return
        cache[videoUrl]?.let { canonical ->
            view.post { patchIframe(view, expectedId, canonical) }
            return
        }
        if (!inFlight.add(videoUrl)) return

        executor.execute {
            val canonical = runCatching { resolver.resolve(videoUrl) }.getOrNull()
            inFlight.remove(videoUrl)
            if (canonical.isNullOrBlank()) return@execute
            cache[videoUrl] = canonical
            view.post { patchIframe(view, expectedId, canonical) }
        }
    }

    private fun patchIframe(view: WebView, expectedId: String, canonicalUrl: String) {
        val expectedJson = JSONObject.quote(expectedId.lowercase())
        val canonicalJson = JSONObject.quote(canonicalUrl)
        val script = """
            (() => {
              const expected = $expectedJson;
              const canonical = $canonicalJson;
              const mappings = window.__easyEducationRumbleEmbeds || Object.create(null);
              mappings[expected] = canonical;
              window.__easyEducationRumbleEmbeds = mappings;

              const apply = () => {
                document.querySelectorAll('iframe[src*="rumble.com/embed/"]').forEach((frame) => {
                  try {
                    const parsed = new URL(frame.src, location.href);
                    const parts = parsed.pathname.split('/').filter(Boolean);
                    if ((parts[0] || '').toLowerCase() !== 'embed') return;
                    const currentId = (parts[1] || '').split('.')[0].toLowerCase();
                    const target = mappings[currentId];
                    if (target && frame.src !== target) frame.src = target;
                  } catch (_) {}
                });
              };

              window.__easyEducationApplyRumbleEmbeds = apply;
              if (!window.__easyEducationRumbleObserver) {
                window.__easyEducationRumbleObserver = new MutationObserver(apply);
                window.__easyEducationRumbleObserver.observe(document.documentElement, {
                  childList: true,
                  subtree: true,
                });
              }
              apply();
            })();
        """.trimIndent()
        view.evaluateJavascript(script, null)
    }
}
