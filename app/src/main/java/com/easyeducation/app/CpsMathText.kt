package com.easyeducation.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnitType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil

private const val CPS_MATH_MAX_CHARS = 16_000
private const val CPS_MATH_PAGE = "file:///android_asset/katex/render.html"

private data class CpsMathSegment(val math: Boolean, val value: String)

/**
 * Real CPS math rendering path. Bengali/English prose stays normal text; TeX spans are handed to
 * bundled KaTeX in a locked-down local WebView. The old regex formatter is intentionally not used.
 */
@Composable
fun CpsMathText(
    raw: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = LocalContentColor.current,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val source = remember(raw) { cpsExamPlainSource(raw) }
    val segments = remember(source) { cpsMathSegments(source) }
    val hasMath = remember(segments) { segments.any { it.math } }

    if (!hasMath) {
        Text(source, modifier = modifier, style = style, color = color)
        return
    }

    var measuredPx by remember(source) { mutableIntStateOf(0) }
    var failed by remember(source) { mutableStateOf(false) }
    val fallback = remember(source) { source.replace("$", "").trim() }
    val fontSizeSp = style.fontSize.takeIf { it.type == TextUnitType.Sp && it.value > 0f }?.value ?: 16f
    val fontWeight = style.fontWeight?.weight ?: 400
    val cssColor = remember(color) { color.toCssHex() }
    val payload = remember(segments, fontSizeSp, fontWeight, cssColor) {
        cpsMathPayload(segments, fontSizeSp, fontWeight, cssColor)
    }

    val webView = remember(source) {
        CpsMathWebView(
            context = context,
            onHeight = { px -> if (px > 0) measuredPx = px.coerceAtMost(12_000) },
            onFailure = { failed = true },
        )
    }

    DisposableEffect(webView) {
        onDispose { webView.dispose() }
    }

    LaunchedEffect(source, measuredPx, failed) {
        if (!failed && measuredPx <= 0) {
            delay(4_000L)
            if (measuredPx <= 0) failed = true
        }
    }

    if (failed) {
        Text(fallback, modifier = modifier, style = style, color = color)
        return
    }

    val placeholder = remember(source) {
        val lines = maxOf(1, ceil(source.length.coerceAtLeast(1) / 42.0).toInt())
        (lines * 22).coerceIn(28, 176).dp
    }
    val renderedHeight = if (measuredPx > 0) with(density) { measuredPx.toDp() } else placeholder

    AndroidView(
        factory = { webView },
        update = { it.submit(payload) },
        modifier = modifier.height(renderedHeight),
    )
}

private fun cpsExamPlainSource(raw: String): String = runCatching {
    android.text.Html.fromHtml(
        raw.take(CPS_MATH_MAX_CHARS),
        android.text.Html.FROM_HTML_MODE_LEGACY,
    ).toString().replace('\u00A0', ' ').trim()
}.getOrElse { raw.take(CPS_MATH_MAX_CHARS).trim() }

/** Pure, deterministic tokenizer for CPS's Bengali/English prose mixed with bare LaTeX. */
private fun cpsMathSegments(input: String): List<CpsMathSegment> {
    if (input.isBlank()) return listOf(CpsMathSegment(false, input))
    val dollarCount = input.count { it == '$' }
    if (dollarCount >= 2 && dollarCount % 2 == 0) return delimitedMathSegments(input)

    val spans = mutableListOf<IntRange>()
    var cursor = 0
    while (cursor < input.length) {
        val trigger = findMathTrigger(input, cursor)
        if (trigger < 0) break
        val start = expandMathStart(input, trigger)
        val endExclusive = consumeMathRun(input, start).coerceAtLeast(trigger + 1)
        if (endExclusive > start) {
            val range = start until endExclusive
            val previous = spans.lastOrNull()
            if (
                previous != null && range.first <= previous.last + 2 &&
                input.substring(previous.last + 1, range.first).all { it.isWhitespace() }
            ) {
                spans[spans.lastIndex] = previous.first..range.last
            } else spans += range
        }
        cursor = maxOf(endExclusive, trigger + 1)
    }
    if (spans.isEmpty()) return listOf(CpsMathSegment(false, input))

    val result = mutableListOf<CpsMathSegment>()
    var at = 0
    spans.forEach { span ->
        if (span.first > at) result += CpsMathSegment(false, input.substring(at, span.first))
        val math = input.substring(span.first, span.last + 1).trim()
        if (math.isNotEmpty()) result += CpsMathSegment(true, math)
        at = span.last + 1
    }
    if (at < input.length) result += CpsMathSegment(false, input.substring(at))
    return result.filter { it.value.isNotEmpty() }
}

private fun delimitedMathSegments(input: String): List<CpsMathSegment> {
    val result = mutableListOf<CpsMathSegment>()
    var at = 0
    while (at < input.length) {
        val start = input.indexOf('$', at)
        if (start < 0) {
            if (at < input.length) result += CpsMathSegment(false, input.substring(at))
            break
        }
        if (start > at) result += CpsMathSegment(false, input.substring(at, start))
        val display = start + 1 < input.length && input[start + 1] == '$'
        val marker = if (display) "$$" else "$"
        val bodyStart = start + marker.length
        val end = input.indexOf(marker, bodyStart)
        if (end < 0) {
            result += CpsMathSegment(false, input.substring(start))
            break
        }
        val math = input.substring(bodyStart, end).trim()
        if (math.isNotEmpty()) result += CpsMathSegment(true, math)
        at = end + marker.length
    }
    return result.ifEmpty { listOf(CpsMathSegment(false, input)) }
}

private fun findMathTrigger(value: String, from: Int): Int {
    var index = from.coerceAtLeast(0)
    while (index < value.length) {
        if (mathTriggerAt(value, index)) return index
        index += 1
    }
    return -1
}

private fun mathTriggerAt(value: String, index: Int): Boolean {
    if (index !in value.indices) return false
    val char = value[index]
    if (char == '\\') return index + 1 < value.length && value[index + 1].isAsciiLetter()
    if (char == '^' || char == '_') {
        if (index + 1 >= value.length) return false
        val next = value[index + 1]
        return next == '{' || next.isAsciiLetterOrDigit() || next == '\\'
    }
    return false
}

private fun expandMathStart(value: String, trigger: Int): Int {
    var start = trigger
    while (start > 0) {
        val previous = value[start - 1]
        if (previous.isWhitespace() || previous.isBengali() || previous == '।') break
        if (previous.isAsciiLetterOrDigit() || previous in ".,+-=/()*[]") start -= 1 else break
    }
    return start
}

private fun consumeMathRun(value: String, start: Int): Int {
    var index = start
    var braceDepth = 0
    while (index < value.length) {
        val char = value[index]
        if (char.isBengali() || char == '।' || char == '\n' || char == '\r') break

        when {
            char == '{' -> { braceDepth += 1; index += 1 }
            char == '}' -> { if (braceDepth > 0) braceDepth -= 1; index += 1 }
            char == '\\' && index + 1 < value.length && value[index + 1].isAsciiLetter() -> {
                index += 2
                while (index < value.length && value[index].isAsciiLetter()) index += 1
                while (index < value.length && value[index].isWhitespace() && value[index] != '\n') index += 1
                while (index < value.length && value[index] == '{') index = consumeBalancedGroup(value, index)
            }
            char == '^' || char == '_' -> {
                index += 1
                if (index < value.length && value[index] == '{') index = consumeBalancedGroup(value, index)
                else if (index < value.length) {
                    if (value[index] == '\\' && index + 1 < value.length) {
                        index += 1
                        while (index < value.length && value[index].isAsciiLetter()) index += 1
                    } else index += 1
                }
            }
            braceDepth > 0 -> index += 1
            char.isWhitespace() -> {
                val next = nextNonSpace(value, index)
                if (next < 0 || value[next].isBengali() || value[next] == '।') break
                val singleLetter = value[next].isAsciiLetter() &&
                    (next + 1 >= value.length || !value[next + 1].isAsciiLetter())
                if (mathTriggerAt(value, next) || value[next].isDigit() || value[next] in "+-=()[]" || singleLetter) {
                    index = next
                } else break
            }
            char.isAsciiLetterOrDigit() || char in ".,+-=/()*[]:%" -> index += 1
            else -> break
        }
    }
    return index
}

private fun consumeBalancedGroup(value: String, open: Int): Int {
    var depth = 0
    var index = open
    while (index < value.length) {
        when (value[index]) {
            '{' -> depth += 1
            '}' -> {
                depth -= 1
                if (depth <= 0) return index + 1
            }
        }
        index += 1
    }
    return value.length
}

private fun nextNonSpace(value: String, from: Int): Int {
    var index = from
    while (index < value.length && value[index].isWhitespace() && value[index] != '\n' && value[index] != '\r') index += 1
    return index.takeIf { it < value.length } ?: -1
}

private fun Char.isAsciiLetter(): Boolean = this in 'A'..'Z' || this in 'a'..'z'
private fun Char.isAsciiLetterOrDigit(): Boolean = isAsciiLetter() || this in '0'..'9'
private fun Char.isBengali(): Boolean = code in 0x0980..0x09FF

private fun cpsMathPayload(
    segments: List<CpsMathSegment>,
    fontSizeSp: Float,
    fontWeight: Int,
    color: String,
): String {
    val rows = JSONArray()
    segments.forEach { segment ->
        rows.put(JSONObject().put("kind", if (segment.math) "math" else "text").put("value", segment.value))
    }
    val json = JSONObject()
        .put("segments", rows)
        .put("fontSize", fontSizeSp.coerceIn(10f, 32f).toDouble())
        .put("fontWeight", fontWeight.coerceIn(100, 900))
        .put("color", color)
        .toString()
    return Base64.encodeToString(json.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
}

private fun Color.toCssHex(): String {
    val rgb = toArgb() and 0x00FFFFFF
    return "#%06X".format(rgb)
}

private class CpsMathBridge(private val onHeight: (Int) -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun reportHeight(px: Double) {
        if (!px.isFinite() || px <= 0.0) return
        main.post { onHeight(ceil(px).toInt()) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private class CpsMathWebView(
    context: Context,
    private val onHeight: (Int) -> Unit,
    private val onFailure: () -> Unit,
) : WebView(context) {
    private var ready = false
    private var pendingPayload = ""
    private var lastRenderedPayload = ""

    init {
        setBackgroundColor(AndroidColor.TRANSPARENT)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        isClickable = false
        isFocusable = false
        isLongClickable = false
        overScrollMode = OVER_SCROLL_NEVER
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        settings.allowContentAccess = false
        settings.allowFileAccess = true
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.blockNetworkLoads = true
        addJavascriptInterface(CpsMathBridge(onHeight), "AndroidMath")
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                if (url == CPS_MATH_PAGE) {
                    ready = true
                    renderPending()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val target = request?.url?.toString().orEmpty()
                return !target.startsWith("file:///android_asset/katex/")
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                ready = false
                Handler(Looper.getMainLooper()).post(onFailure)
                return true
            }
        }
        loadUrl(CPS_MATH_PAGE)
    }

    override fun onTouchEvent(event: MotionEvent?): Boolean = false

    fun submit(payload: String) {
        pendingPayload = payload
        renderPending()
    }

    private fun renderPending() {
        if (!ready || pendingPayload.isBlank() || pendingPayload == lastRenderedPayload) return
        val safe = pendingPayload
        evaluateJavascript("window.renderContent && window.renderContent('$safe')") { result ->
            if (result == null || result == "false") onFailure()
        }
        lastRenderedPayload = pendingPayload
    }

    fun dispose() {
        runCatching { removeJavascriptInterface("AndroidMath") }
        runCatching { stopLoading() }
        runCatching { loadUrl("about:blank") }
        runCatching { destroy() }
    }
}
