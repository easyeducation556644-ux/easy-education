@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.easyeducation.app

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.imageLoader
import coil.request.ImageRequest
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

internal data class ExamPreparationProgress(
    val percent: Int = 0,
    val status: String = "Starting…",
    val questionsDone: Int = 0,
    val questionsTotal: Int = 0,
    val optionsDone: Int = 0,
    val optionsTotal: Int = 0,
    val mathDone: Int = 0,
    val mathTotal: Int = 0,
    val imagesDone: Int = 0,
    val imagesTotal: Int = 0,
)

internal data class CpsPreparedMathAsset(
    val formula: String,
    val hash: String,
    val file: File,
    val widthPx: Int,
    val heightPx: Int,
)

internal data class CpsPreparedResources(
    val math: Map<String, CpsPreparedMathAsset> = emptyMap(),
)

internal data class CpsPreparedSegment(val math: Boolean, val value: String)

internal class CpsExamAssetPreloader(private val context: Context) {
    private val appContext = context.applicationContext
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(50, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val mathDir = File(appContext.cacheDir, "cps_exam_math/server-png-v1").apply { mkdirs() }

    suspend fun prepare(
        questionTexts: List<String>,
        optionTexts: List<String>,
        explanationTexts: List<String>,
        imageUrls: List<String>,
        questionDone: Int,
        questionTotal: Int,
        onProgress: (ExamPreparationProgress) -> Unit,
    ): CpsPreparedResources {
        val formulas = linkedSetOf<String>()
        questionTexts.forEach { text ->
            cpsPreparedSegments(text).filterToFormulaSet(formulas)
        }
        explanationTexts.forEach { text ->
            cpsPreparedSegments(text).filterToFormulaSet(formulas)
        }

        val optionTotal = optionTexts.size
        optionTexts.forEachIndexed { index, text ->
            cpsPreparedSegments(text).filterToFormulaSet(formulas)
            onProgress(
                ExamPreparationProgress(
                    percent = 28 + (((index + 1) * 12.0) / optionTotal.coerceAtLeast(1)).roundToInt(),
                    status = "Preparing options — ${index + 1}/$optionTotal",
                    questionsDone = questionDone,
                    questionsTotal = questionTotal,
                    optionsDone = index + 1,
                    optionsTotal = optionTotal,
                ),
            )
        }
        if (optionTotal == 0) {
            onProgress(
                ExamPreparationProgress(
                    percent = 40,
                    status = "Scanning mathematics…",
                    questionsDone = questionDone,
                    questionsTotal = questionTotal,
                    optionsDone = 0,
                    optionsTotal = 0,
                ),
            )
        }

        val uniqueFormulas = formulas.toList()
        val assets = linkedMapOf<String, CpsPreparedMathAsset>()
        val missing = mutableListOf<String>()
        uniqueFormulas.forEach { formula ->
            val hash = mathHash(formula)
            val file = File(mathDir, "$hash.png")
            val cached = file.takeIf { it.isFile && it.length() > 8L }?.let {
                readMathAsset(formula, hash, it)
            }
            if (cached != null) assets[formula] = cached else {
                file.delete()
                missing += formula
            }
        }

        var mathDone = assets.size
        onProgress(
            ExamPreparationProgress(
                percent = if (uniqueFormulas.isEmpty()) 72 else 42 + ((mathDone * 30.0) / uniqueFormulas.size).roundToInt(),
                status = if (uniqueFormulas.isEmpty()) "No mathematical rendering needed" else "Rendering mathematics — $mathDone/${uniqueFormulas.size}",
                questionsDone = questionDone,
                questionsTotal = questionTotal,
                optionsDone = optionTotal,
                optionsTotal = optionTotal,
                mathDone = mathDone,
                mathTotal = uniqueFormulas.size,
            ),
        )

        if (missing.isNotEmpty()) {
            missing.chunked(MATH_BATCH).forEach { chunk ->
                val rendered = fetchRenderedMath(chunk)
                chunk.forEach { formula ->
                    rendered[formula]?.let { asset -> assets[formula] = asset }
                    mathDone += 1
                    onProgress(
                        ExamPreparationProgress(
                            percent = 42 + ((mathDone * 30.0) / uniqueFormulas.size.coerceAtLeast(1)).roundToInt(),
                            status = "Rendering mathematics — $mathDone/${uniqueFormulas.size}",
                            questionsDone = questionDone,
                            questionsTotal = questionTotal,
                            optionsDone = optionTotal,
                            optionsTotal = optionTotal,
                            mathDone = mathDone,
                            mathTotal = uniqueFormulas.size,
                        ),
                    )
                }
            }
        }

        // Warm static PNGs so scrolling does not pay decode cost.
        assets.values.forEach { asset ->
            runCatching {
                withContext(Dispatchers.IO) {
                    appContext.imageLoader.execute(
                        ImageRequest.Builder(appContext)
                            .data(asset.file)
                            .memoryCacheKey("cps-math:${asset.hash}")
                            .diskCacheKey("cps-math:${asset.hash}")
                            .build(),
                    )
                }
            }
        }

        val images = imageUrls.asSequence()
            .map(String::trim)
            .filter { it.startsWith("https://") || it.startsWith("http://") }
            .distinct()
            .toList()
        images.forEachIndexed { index, url ->
            runCatching {
                withContext(Dispatchers.IO) {
                    appContext.imageLoader.execute(
                        ImageRequest.Builder(appContext)
                            .data(url)
                            .memoryCacheKey(url)
                            .diskCacheKey(url)
                            .build(),
                    )
                }
            }
            onProgress(
                ExamPreparationProgress(
                    percent = 74 + (((index + 1) * 22.0) / images.size.coerceAtLeast(1)).roundToInt(),
                    status = "Caching images — ${index + 1}/${images.size}",
                    questionsDone = questionDone,
                    questionsTotal = questionTotal,
                    optionsDone = optionTotal,
                    optionsTotal = optionTotal,
                    mathDone = uniqueFormulas.size,
                    mathTotal = uniqueFormulas.size,
                    imagesDone = index + 1,
                    imagesTotal = images.size,
                ),
            )
        }

        onProgress(
            ExamPreparationProgress(
                percent = 100,
                status = "Ready",
                questionsDone = questionDone,
                questionsTotal = questionTotal,
                optionsDone = optionTotal,
                optionsTotal = optionTotal,
                mathDone = uniqueFormulas.size,
                mathTotal = uniqueFormulas.size,
                imagesDone = images.size,
                imagesTotal = images.size,
            ),
        )
        return CpsPreparedResources(assets)
    }

    private suspend fun fetchRenderedMath(formulas: List<String>): Map<String, CpsPreparedMathAsset> =
        withContext(Dispatchers.IO) {
            val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
            val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
            val body = JSONObject().put("formulas", JSONArray(formulas)).toString()
            val request = Request.Builder()
                .url("$APP_ORIGIN/api/version?resource=cps&action=math-svg")
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val detail = runCatching { JSONObject(text).optString("error") }.getOrNull()
                    error(detail?.takeIf(String::isNotBlank) ?: "Math preparation failed (${response.code})")
                }
                val payload = JSONObject(text)
                val items = payload.optJSONArray("items") ?: JSONArray()
                buildMap {
                    for (index in 0 until items.length()) {
                        val row = items.optJSONObject(index) ?: continue
                        if (row.optString("error").isNotBlank()) continue
                        val formula = row.optString("formula").trim()
                        val hash = row.optString("hash").trim().ifBlank { mathHash(formula) }
                        val encoded = row.optString("pngBase64")
                        if (formula.isBlank() || encoded.isBlank()) continue
                        val bytes = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull() ?: continue
                        if (bytes.size < 8 || bytes.size > MAX_PNG_BYTES) continue
                        val file = File(mathDir, "$hash.png")
                        runCatching {
                            val temp = File(mathDir, "$hash.tmp")
                            temp.writeBytes(bytes)
                            if (file.exists()) file.delete()
                            if (!temp.renameTo(file)) {
                                file.writeBytes(bytes)
                                temp.delete()
                            }
                        }.getOrElse { continue }
                        val width = row.optInt("width", 0)
                        val height = row.optInt("height", 0)
                        val asset = if (width > 0 && height > 0) {
                            CpsPreparedMathAsset(formula, hash, file, width, height)
                        } else readMathAsset(formula, hash, file)
                        asset?.let { put(formula, it) }
                    }
                }
            }
        }

    private fun readMathAsset(formula: String, hash: String, file: File): CpsPreparedMathAsset? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, options)
        if (options.outWidth <= 0 || options.outHeight <= 0) return null
        return CpsPreparedMathAsset(formula, hash, file, options.outWidth, options.outHeight)
    }

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        private const val MATH_BATCH = 10
        private const val MAX_PNG_BYTES = 384 * 1024
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

private fun List<CpsPreparedSegment>.filterToFormulaSet(target: MutableSet<String>) {
    forEach { segment -> if (segment.math && segment.value.isNotBlank()) target += segment.value.trim() }
}

internal fun mathHash(formula: String): String = MessageDigest.getInstance("SHA-256")
    .digest(formula.trim().toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

/**
 * Detects CPS bare TeX without running a TeX engine on Android. Parsing is intentionally lightweight;
 * expensive typesetting happens on the existing Vercel function and returns static PNGs.
 */
internal fun cpsPreparedSegments(input: String): List<CpsPreparedSegment> {
    if (input.isBlank()) return listOf(CpsPreparedSegment(false, input))
    val dollarCount = input.count { it == '$' }
    if (dollarCount >= 2 && dollarCount % 2 == 0) return delimitedSegments(input)

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
            if (previous != null && range.first <= previous.last + 2 &&
                input.substring(previous.last + 1, range.first).all(Char::isWhitespace)
            ) {
                spans[spans.lastIndex] = previous.first..range.last
            } else spans += range
        }
        cursor = maxOf(endExclusive, trigger + 1)
    }
    if (spans.isEmpty()) return listOf(CpsPreparedSegment(false, input))

    val result = mutableListOf<CpsPreparedSegment>()
    var at = 0
    spans.forEach { span ->
        if (span.first > at) result += CpsPreparedSegment(false, input.substring(at, span.first))
        val formula = input.substring(span.first, span.last + 1).trim()
        if (formula.isNotEmpty()) result += CpsPreparedSegment(true, formula)
        at = span.last + 1
    }
    if (at < input.length) result += CpsPreparedSegment(false, input.substring(at))
    return result.filter { it.value.isNotEmpty() }
}

private fun delimitedSegments(input: String): List<CpsPreparedSegment> {
    val result = mutableListOf<CpsPreparedSegment>()
    var at = 0
    while (at < input.length) {
        val start = input.indexOf('$', at)
        if (start < 0) {
            if (at < input.length) result += CpsPreparedSegment(false, input.substring(at))
            break
        }
        if (start > at) result += CpsPreparedSegment(false, input.substring(at, start))
        val display = start + 1 < input.length && input[start + 1] == '$'
        val marker = if (display) "$$" else "$"
        val bodyStart = start + marker.length
        val end = input.indexOf(marker, bodyStart)
        if (end < 0) {
            result += CpsPreparedSegment(false, input.substring(start))
            break
        }
        val formula = input.substring(bodyStart, end).trim()
        if (formula.isNotEmpty()) result += CpsPreparedSegment(true, formula)
        at = end + marker.length
    }
    return result.ifEmpty { listOf(CpsPreparedSegment(false, input)) }
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
                if (mathTriggerAt(value, next) || value[next].isDigit() || value[next] in "+-=()[]" || singleLetter) index = next
                else break
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

private data class DisplayToken(val math: Boolean, val value: String)

private fun displayLines(raw: String): List<List<DisplayToken>> {
    val lines = mutableListOf(mutableListOf<DisplayToken>())
    cpsPreparedSegments(raw).forEach { segment ->
        if (segment.math) {
            lines.last() += DisplayToken(true, segment.value.trim())
            return@forEach
        }
        val parts = segment.value.split('\n')
        parts.forEachIndexed { index, part ->
            Regex("\\S+\\s*|\\s+").findAll(part).forEach { match ->
                lines.last() += DisplayToken(false, match.value)
            }
            if (index < parts.lastIndex) lines += mutableListOf()
        }
    }
    return lines.ifEmpty { listOf(emptyList()) }
}

@Composable
internal fun CpsPreparedText(
    raw: String,
    resources: CpsPreparedResources,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = LocalContentColor.current,
) {
    val segments = remember(raw) { cpsPreparedSegments(raw) }
    if (segments.none { it.math }) {
        Text(raw, modifier = modifier, style = style, color = color)
        return
    }

    val lines = remember(raw) { displayLines(raw) }
    val screenWidth = LocalConfiguration.current.screenWidthDp
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        lines.forEach { line ->
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Start,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                line.forEach { token ->
                    if (!token.math) {
                        Text(token.value, style = style, color = color)
                    } else {
                        val asset = resources.math[token.value]
                        if (asset == null) {
                            Text(mathFallback(token.value), style = style, color = color)
                        } else {
                            val ratio = (asset.widthPx.toFloat() / asset.heightPx.coerceAtLeast(1)).coerceIn(0.2f, 30f)
                            val baseHeight = 23f
                            val maxWidth = (screenWidth - 28).coerceAtLeast(120).toFloat()
                            val naturalWidth = baseHeight * ratio
                            val widthDp = minOf(naturalWidth, maxWidth)
                            val heightDp = (widthDp / ratio).coerceIn(14f, 42f)
                            AsyncImage(
                                model = asset.file,
                                contentDescription = null,
                                modifier = Modifier.width(widthDp.dp).height(heightDp.dp),
                                contentScale = ContentScale.Fit,
                                colorFilter = ColorFilter.tint(color),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Emergency display fallback only; server rendering is the primary path. */
private fun mathFallback(value: String): String = value
    .replace("\\circ", "°")
    .replace("\\times", "×")
    .replace("\\lambda", "λ")
    .replace("\\theta", "θ")
    .replace("\\pi", "π")
    .replace(Regex("\\\\text\\s*\\{([^{}]*)}"), "$1")
    .replace("{", "")
    .replace("}", "")
    .trim()
