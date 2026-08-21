package com.easyeducation.app

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.services.youtube.extractors.YoutubeStreamExtractor
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin adapter around the mature YouTube extractor. It is deliberately kept separate from the
 * Easy Education download/storage stack: the extractor only resolves current, deciphered media
 * URLs and metadata; downloading, pause/resume, muxing and encryption remain ours.
 */
object YoutubeExtractorEngine {
    private val initLock = Any()
    @Volatile private var initialized = false

    fun resolve(context: Context, sourceUrl: String): StreamInfo {
        ensureInitialized(context.applicationContext)
        return StreamInfo.getInfo(sourceUrl)
    }

    private fun ensureInitialized(context: Context) {
        if (initialized) return
        synchronized(initLock) {
            if (initialized) return
            NewPipe.init(EasyNewPipeDownloader())
            YoutubeStreamExtractor.setPoTokenProvider(EasyYoutubePoTokenProvider(context))
            initialized = true
        }
    }
}

private class EasyNewPipeDownloader : Downloader() {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    @Throws(IOException::class, ReCaptchaException::class)
    override fun execute(request: Request): Response {
        val method = request.httpMethod().uppercase()
        val data = request.dataToSend()
        val body = when (method) {
            "POST", "PUT", "PATCH" -> (data ?: ByteArray(0)).toRequestBody()
            else -> null
        }
        val builder = okhttp3.Request.Builder()
            .url(request.url())
            .method(method, body)
            .header("User-Agent", DEFAULT_WEB_USER_AGENT)

        request.headers().forEach { (name, values) ->
            builder.removeHeader(name)
            values.forEach { value -> builder.addHeader(name, value) }
        }

        return http.newCall(builder.build()).execute().use { response ->
            if (response.code == 429) {
                throw ReCaptchaException("YouTube rate limit / CAPTCHA requested", request.url())
            }
            Response(
                response.code,
                response.message,
                response.headers.toMultimap(),
                response.body?.string().orEmpty(),
                response.request.url.toString(),
            )
        }
    }

    companion object {
        private const val DEFAULT_WEB_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0"
    }
}
