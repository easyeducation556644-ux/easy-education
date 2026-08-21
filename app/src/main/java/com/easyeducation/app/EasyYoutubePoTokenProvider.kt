package com.easyeducation.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.firebase.crashlytics.FirebaseCrashlytics
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.services.youtube.InnertubeClientRequestInfo
import org.schabi.newpipe.extractor.services.youtube.PoTokenProvider
import org.schabi.newpipe.extractor.services.youtube.PoTokenResult
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Web BotGuard PO-token provider.
 *
 * The flow mirrors YouTube's browser client and the mechanism used by the reference downloader
 * supplied for this project: JNN Create -> execute BotGuard in a real Android WebView -> GenerateIT
 * -> mint a video-bound PO token. The same generator is reused until its integrity token is near
 * expiry, avoiding a WebView/BotGuard bootstrap on every quality lookup.
 */
class EasyYoutubePoTokenProvider(context: Context) : PoTokenProvider {
    private val appContext = context.applicationContext
    private val lock = Any()

    @Volatile private var generator: EasyPoTokenWebView? = null
    @Volatile private var visitorData: String? = null

    override fun getWebClientPoToken(videoId: String): PoTokenResult? = runCatching {
        synchronized(lock) {
            val data = visitorData ?: obtainVisitorData().also { visitorData = it }
            val active = generator?.takeUnless { it.isExpired() } ?: runBlocking {
                generator?.closeSafely()
                EasyPoTokenWebView.create(appContext)
            }.also { generator = it }
            val token = runBlocking { withTimeout(TOKEN_TIMEOUT_MS) { active.generatePoToken(videoId) } }
            PoTokenResult(data, token, token)
        }
    }.getOrNull()

    override fun getWebEmbedClientPoToken(videoId: String?): PoTokenResult? = null
    override fun getAndroidClientPoToken(videoId: String?): PoTokenResult? = null
    override fun getIosClientPoToken(videoId: String?): PoTokenResult? = null

    private fun obtainVisitorData(): String {
        val info = InnertubeClientRequestInfo.ofWebClient()
        info.clientInfo.clientVersion = YoutubeParsingHelper.getClientVersion()
        return YoutubeParsingHelper.getVisitorDataFromInnertube(
            info,
            NewPipe.getPreferredLocalization(),
            NewPipe.getPreferredContentCountry(),
            YoutubeParsingHelper.getYouTubeHeaders(),
            YoutubeParsingHelper.YOUTUBEI_V1_URL,
            null,
            false,
        )
    }

    companion object {
        private const val TOKEN_TIMEOUT_MS = 35_000L
    }
}

private class EasyPoTokenWebView private constructor(
    context: Context,
    private val initialization: CompletableDeferred<EasyPoTokenWebView>,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(32, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val webView = WebView(context)
    private val pendingTokens = ConcurrentHashMap<String, CompletableDeferred<String>>()

    @Volatile private var expiresAt: Instant = Instant.EPOCH
    @Volatile private var closed = false

    init {
        webView.settings.apply {
            javaScriptEnabled = true
            safeBrowsingEnabled = false
            userAgentString = BOTGUARD_USER_AGENT
            blockNetworkLoads = true
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.addJavascriptInterface(this, JS_INTERFACE)
    }

    private fun start(context: Context) {
        runCatching {
            val html = context.assets.open("po_token.html").bufferedReader().use { it.readText() }
            webView.loadDataWithBaseURL(
                "https://www.youtube.com",
                html,
                "text/html",
                "utf-8",
                null,
            )
        }.onFailure(::failInitialization)
    }

    @JavascriptInterface
    fun downloadAndRunBotguard() {
        Thread {
            runCatching {
                val raw = botguardRequest(CREATE_URL, listOf(REQUEST_KEY))
                val challenge = parseChallengeData(raw)
                Handler(Looper.getMainLooper()).post {
                    if (closed) return@post
                    webView.evaluateJavascript(
                        """try {
                            data = $challenge;
                            runBotGuard(data).then(function(result) {
                                this.webPoSignalOutput = result.webPoSignalOutput;
                                $JS_INTERFACE.onRunBotguardResult(result.botguardResponse);
                            }, function(error) {
                                $JS_INTERFACE.onJsInitializationError(error + "\\n" + error.stack);
                            });
                        } catch(error) {
                            $JS_INTERFACE.onJsInitializationError(error + "\\n" + error.stack);
                        }""".trimIndent(),
                        null,
                    )
                }
            }.onFailure(::failInitialization)
        }.start()
    }

    @JavascriptInterface
    fun onJsInitializationError(error: String) {
        failInitialization(IllegalStateException("YouTube BotGuard initialization failed: $error"))
    }

    @JavascriptInterface
    fun onRunBotguardResult(botguardResponse: String) {
        Thread {
            runCatching {
                val raw = botguardRequest(GENERATE_IT_URL, listOf(REQUEST_KEY, botguardResponse))
                val (integrityJs, ttlSeconds) = parseIntegrityTokenData(raw)
                val safeTtl = (ttlSeconds - 600L).coerceAtLeast(60L)
                expiresAt = Instant.now().plusSeconds(safeTtl)
                Handler(Looper.getMainLooper()).post {
                    if (closed) return@post
                    webView.evaluateJavascript("this.integrityToken = $integrityJs") {
                        initialization.complete(this@EasyPoTokenWebView)
                    }
                }
            }.onFailure(::failInitialization)
        }.start()
    }

    suspend fun generatePoToken(identifier: String): String {
        check(!closed) { "PO-token generator is closed" }
        val result = CompletableDeferred<String>()
        val existing = pendingTokens.putIfAbsent(identifier, result)
        if (existing != null) return existing.await()

        val safeIdentifier = JSONObject.quote(identifier)
        val identifierU8 = newUint8Array(identifier.toByteArray(Charsets.UTF_8))
        Handler(Looper.getMainLooper()).post {
            if (closed) {
                pendingTokens.remove(identifier)?.completeExceptionally(
                    IllegalStateException("PO-token generator was closed"),
                )
                return@post
            }
            webView.evaluateJavascript(
                """try {
                    identifier = $safeIdentifier;
                    u8Identifier = $identifierU8;
                    poTokenU8 = obtainPoToken(webPoSignalOutput, integrityToken, u8Identifier);
                    poTokenU8String = "";
                    for (i = 0; i < poTokenU8.length; i++) {
                        if (i != 0) poTokenU8String += ",";
                        poTokenU8String += poTokenU8[i];
                    }
                    $JS_INTERFACE.onObtainPoTokenResult(identifier, poTokenU8String);
                } catch(error) {
                    $JS_INTERFACE.onObtainPoTokenError(identifier, error + "\\n" + error.stack);
                }""".trimIndent(),
                null,
            )
        }
        return result.await()
    }

    @JavascriptInterface
    fun onObtainPoTokenResult(identifier: String, byteList: String) {
        val deferred = pendingTokens.remove(identifier) ?: return
        runCatching {
            val bytes = if (byteList.isBlank()) ByteArray(0) else byteList.split(',')
                .map { it.trim().toInt().toByte() }
                .toByteArray()
            require(bytes.isNotEmpty()) { "YouTube returned an empty PO token" }
            Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP)
        }.onSuccess(deferred::complete).onFailure(deferred::completeExceptionally)
    }

    @JavascriptInterface
    fun onObtainPoTokenError(identifier: String, error: String) {
        pendingTokens.remove(identifier)?.completeExceptionally(
            IllegalStateException("YouTube PO-token minting failed: $error"),
        )
    }

    fun isExpired(): Boolean = closed || Instant.now().isAfter(expiresAt)

    fun closeSafely() {
        Handler(Looper.getMainLooper()).post {
            if (closed) return@post
            closed = true
            pendingTokens.values.forEach {
                it.completeExceptionally(IllegalStateException("PO-token generator closed"))
            }
            pendingTokens.clear()
            runCatching { webView.removeJavascriptInterface(JS_INTERFACE) }
            runCatching { webView.stopLoading() }
            runCatching { webView.loadUrl("about:blank") }
            runCatching { webView.clearHistory() }
            runCatching { webView.destroy() }
        }
    }

    private fun botguardRequest(url: String, data: List<String>): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", BOTGUARD_USER_AGENT)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json+protobuf")
            .header("x-goog-api-key", BOTGUARD_API_KEY)
            .header("x-user-agent", "grpc-web-javascript/0.1")
            .post(JSONArray(data).toString().toRequestBody(BOTGUARD_MEDIA_TYPE))
            .build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("YouTube BotGuard HTTP ${response.code}")
            response.body?.string()?.takeIf { it.isNotBlank() }
                ?: error("YouTube BotGuard returned an empty response")
        }
    }

    private fun failInitialization(error: Throwable) {
        initialization.completeExceptionally(error)
        closeSafely()
    }

    companion object {
        private const val JS_INTERFACE = "PoTokenWebView"
        private const val REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
        private const val CREATE_URL = "https://www.youtube.com/api/jnn/v1/Create"
        private const val GENERATE_IT_URL = "https://www.youtube.com/api/jnn/v1/GenerateIT"
        private const val BOTGUARD_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"
        private const val BOTGUARD_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        private val BOTGUARD_MEDIA_TYPE = "application/json+protobuf".toMediaType()

        suspend fun create(context: Context): EasyPoTokenWebView = withContext(Dispatchers.Default) {
            withTimeout(35_000L) {
                val ready = CompletableDeferred<EasyPoTokenWebView>()
                Handler(Looper.getMainLooper()).post {
                    val generator = EasyPoTokenWebView(context.applicationContext, ready)
                    generator.start(context.applicationContext)
                }
                ready.await()
            }
        }

        private fun parseChallengeData(raw: String): String {
            val scrambled = JSONArray(raw)
            val challenge = if (scrambled.length() > 1 && scrambled.opt(1) is String) {
                val decoded = base64DecodeYoutube(scrambled.getString(1))
                    .map { (it.toInt() + 97).toByte() }
                    .toByteArray()
                    .toString(Charsets.UTF_8)
                JSONArray(decoded)
            } else {
                scrambled.getJSONArray(0)
            }

            fun firstString(index: Int): String? {
                val array = challenge.optJSONArray(index) ?: return null
                for (i in 0 until array.length()) {
                    if (array.opt(i) is String) return array.optString(i)
                }
                return null
            }

            return JSONObject()
                .put("messageId", challenge.optString(0))
                .put(
                    "interpreterJavascript",
                    JSONObject()
                        .put("privateDoNotAccessOrElseSafeScriptWrappedValue", firstString(1))
                        .put("privateDoNotAccessOrElseTrustedResourceUrlWrappedValue", firstString(2)),
                )
                .put("interpreterHash", challenge.optString(3))
                .put("program", challenge.optString(4))
                .put("globalName", challenge.optString(5))
                .put("clientExperimentsStateBlob", challenge.optString(7))
                .toString()
        }

        private fun parseIntegrityTokenData(raw: String): Pair<String, Long> {
            val data = JSONArray(raw)
            val token = base64DecodeYoutube(data.getString(0))
            val ttl = data.optLong(1, 3600L)
            return newUint8Array(token) to ttl
        }

        private fun base64DecodeYoutube(value: String): ByteArray {
            val normalized = value
                .replace('-', '+')
                .replace('_', '/')
                .replace('.', '=')
            val padding = (4 - normalized.length % 4) % 4
            return Base64.decode(normalized + "=".repeat(padding), Base64.DEFAULT)
        }

        private fun newUint8Array(bytes: ByteArray): String =
            "new Uint8Array([" + bytes.joinToString(",") { (it.toInt() and 0xff).toString() } + "])"
    }
}
