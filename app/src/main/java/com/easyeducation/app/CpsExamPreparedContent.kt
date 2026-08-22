package com.easyeducation.app

import android.content.Context
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.MessageDigest

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

/**
 * Lightweight native exam resources. The running exam never creates WebViews and never waits for
 * a TeX renderer. The formatter below intentionally avoids java.util.regex entirely so malformed
 * CPS text cannot trigger PatternSyntaxException while an exam opens.
 */
internal data class CpsPreparedResources(
    val renderer: String = "native-fast-math-v3",
)

internal data class CpsPreparedSegment(val math: Boolean, val value: String)

internal class CpsExamAssetPreloader(context: Context) {
    private val appContext = context.applicationContext

    suspend fun prepare(
        questionTexts: List<String>,
        optionTexts: List<String>,
        explanationTexts: List<String>,
        imageUrls: List<String>,
        questionDone: Int,
        questionTotal: Int,
        onProgress: (ExamPreparationProgress) -> Unit,
    ): CpsPreparedResources {
        val optionTotal = optionTexts.size
        onProgress(
            ExamPreparationProgress(
                percent = 55,
                status = "Preparing exam text…",
                questionsDone = questionDone,
                questionsTotal = questionTotal,
                optionsDone = optionTotal,
                optionsTotal = optionTotal,
            ),
        )

        var mathLike = 0
        (questionTexts.asSequence() + optionTexts.asSequence() + explanationTexts.asSequence())
            .forEach { raw ->
                if (looksLikeMath(raw)) mathLike += 1
                normalizeCpsMathText(raw)
            }

        val images = imageUrls.asSequence()
            .map(String::trim)
            .filter { it.startsWith("https://") || it.startsWith("http://") }
            .distinct()
            .toList()

        // Images are warmed asynchronously. They never block the student from entering the exam.
        if (images.isNotEmpty()) {
            imageWarmScope.launch {
                images.forEach { url ->
                    runCatching {
                        appContext.imageLoader.execute(
                            ImageRequest.Builder(appContext)
                                .data(url)
                                .memoryCacheKey(url)
                                .diskCacheKey(url)
                                .memoryCachePolicy(CachePolicy.ENABLED)
                                .diskCachePolicy(CachePolicy.ENABLED)
                                .networkCachePolicy(CachePolicy.ENABLED)
                                .build(),
                        )
                    }
                }
            }
        }

        onProgress(
            ExamPreparationProgress(
                percent = 100,
                status = "Ready",
                questionsDone = questionDone,
                questionsTotal = questionTotal,
                optionsDone = optionTotal,
                optionsTotal = optionTotal,
                mathDone = mathLike,
                mathTotal = mathLike,
                imagesDone = 0,
                imagesTotal = images.size,
            ),
        )
        return CpsPreparedResources()
    }

    companion object {
        private val imageWarmScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}

internal fun mathHash(formula: String): String = MessageDigest.getInstance("SHA-256")
    .digest(formula.trim().toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

@Composable
internal fun CpsPreparedText(
    raw: String,
    resources: CpsPreparedResources,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = LocalContentColor.current,
) {
    val normalized = remember(raw, resources.renderer) { normalizeCpsMathText(raw) }
    Text(text = normalized, modifier = modifier, style = style, color = color)
}

internal fun cpsPreparedSegments(input: String): List<CpsPreparedSegment> =
    listOf(CpsPreparedSegment(math = looksLikeMath(input), value = normalizeCpsMathText(input)))

private fun looksLikeMath(value: String): Boolean =
    value.indexOf('\\') >= 0 || value.indexOf('$') >= 0 || value.indexOf('^') >= 0 || value.indexOf('_') >= 0

/**
 * Safe native CPS math normalizer. No Regex objects are created here. Any unexpected formatter
 * problem falls back to minimally cleaned plain text instead of failing the exam screen.
 */
internal fun normalizeCpsMathText(input: String): String = runCatching {
    normalizeCpsMathTextUnsafe(input)
}.getOrElse {
    input.replace("\\", "").replace("{", "").replace("}", "").trim()
}

private fun normalizeCpsMathTextUnsafe(input: String): String {
    if (input.isBlank()) return input
    var value = input
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("######", "")
        .replace("#####", "")
        .replace("####", "")
        .replace("###", "")
        .replace("##", "")
        .replace("**", "")
        .replace("__", "")
        .replace("$$", "")
        .replace("$", "")
        .replace("\\left", "")
        .replace("\\right", "")
        .replace("\\,", " ")
        .replace("\\;", " ")
        .replace("\\!", "")

    repeat(5) {
        value = replaceUnaryCommand(value, "\\text") { it }
        value = replaceUnaryCommand(value, "\\mathrm") { it }
        value = replaceUnaryCommand(value, "\\mathbf") { it }
        value = replaceUnaryCommand(value, "\\operatorname") { it }
        value = replaceUnaryCommand(value, "\\sqrt") { "√($it)" }
        value = replaceFractionCommand(value)
    }

    val commands = linkedMapOf(
        "\\varepsilon" to "ε", "\\vartheta" to "ϑ", "\\varphi" to "ϕ",
        "\\alpha" to "α", "\\beta" to "β", "\\gamma" to "γ", "\\delta" to "δ",
        "\\epsilon" to "ε", "\\zeta" to "ζ", "\\eta" to "η", "\\theta" to "θ",
        "\\iota" to "ι", "\\kappa" to "κ", "\\lambda" to "λ", "\\mu" to "μ",
        "\\nu" to "ν", "\\xi" to "ξ", "\\pi" to "π", "\\rho" to "ρ",
        "\\sigma" to "σ", "\\tau" to "τ", "\\phi" to "φ", "\\chi" to "χ",
        "\\psi" to "ψ", "\\omega" to "ω", "\\Delta" to "Δ", "\\Theta" to "Θ",
        "\\Lambda" to "Λ", "\\Pi" to "Π", "\\Sigma" to "Σ", "\\Phi" to "Φ",
        "\\Psi" to "Ψ", "\\Omega" to "Ω", "\\times" to "×", "\\cdot" to "·",
        "\\pm" to "±", "\\mp" to "∓", "\\leq" to "≤", "\\le" to "≤",
        "\\geq" to "≥", "\\ge" to "≥", "\\neq" to "≠", "\\approx" to "≈",
        "\\equiv" to "≡", "\\propto" to "∝", "\\infty" to "∞", "\\degree" to "°",
        "\\circ" to "°", "\\rightarrow" to "→", "\\leftarrow" to "←",
        "\\Rightarrow" to "⇒", "\\sin" to "sin", "\\cos" to "cos", "\\tan" to "tan",
        "\\cot" to "cot", "\\sec" to "sec", "\\csc" to "csc", "\\log" to "log",
        "\\ln" to "ln",
    )
    commands.forEach { (command, replacement) -> value = value.replace(command, replacement) }

    value = replaceUnaryCommand(value, "\\vec") { "$it⃗" }
    value = replaceUnaryCommand(value, "\\hat") { "$it̂" }
    value = replaceUnaryCommand(value, "\\bar") { "$it̄" }
    value = replaceScripts(value)
    value = stripUnknownCommands(value)
        .replace("{", "")
        .replace("}", "")

    return tidyWhitespace(value)
}

private fun replaceUnaryCommand(source: String, command: String, transform: (String) -> String): String {
    var value = source
    var searchFrom = 0
    while (searchFrom < value.length) {
        val index = value.indexOf(command, searchFrom)
        if (index < 0) break
        var cursor = index + command.length
        if (cursor < value.length && value[cursor].isLetter()) {
            searchFrom = cursor
            continue
        }
        while (cursor < value.length && value[cursor].isWhitespace() && value[cursor] != '\n') cursor++
        if (cursor >= value.length || value[cursor] != '{') {
            searchFrom = index + command.length
            continue
        }
        val close = matchingBrace(value, cursor)
        if (close < 0) {
            searchFrom = cursor + 1
            continue
        }
        val replacement = transform(value.substring(cursor + 1, close))
        value = value.substring(0, index) + replacement + value.substring(close + 1)
        searchFrom = index + replacement.length
    }
    return value
}

private fun replaceFractionCommand(source: String): String {
    var value = source
    var searchFrom = 0
    val command = "\\frac"
    while (searchFrom < value.length) {
        val index = value.indexOf(command, searchFrom)
        if (index < 0) break
        var firstOpen = index + command.length
        while (firstOpen < value.length && value[firstOpen].isWhitespace() && value[firstOpen] != '\n') firstOpen++
        if (firstOpen >= value.length || value[firstOpen] != '{') {
            searchFrom = index + command.length
            continue
        }
        val firstClose = matchingBrace(value, firstOpen)
        if (firstClose < 0) {
            searchFrom = firstOpen + 1
            continue
        }
        var secondOpen = firstClose + 1
        while (secondOpen < value.length && value[secondOpen].isWhitespace() && value[secondOpen] != '\n') secondOpen++
        if (secondOpen >= value.length || value[secondOpen] != '{') {
            searchFrom = firstClose + 1
            continue
        }
        val secondClose = matchingBrace(value, secondOpen)
        if (secondClose < 0) {
            searchFrom = secondOpen + 1
            continue
        }
        val numerator = value.substring(firstOpen + 1, firstClose)
        val denominator = value.substring(secondOpen + 1, secondClose)
        val replacement = "($numerator)/($denominator)"
        value = value.substring(0, index) + replacement + value.substring(secondClose + 1)
        searchFrom = index + replacement.length
    }
    return value
}

private fun matchingBrace(value: String, open: Int): Int {
    if (open !in value.indices || value[open] != '{') return -1
    var depth = 0
    for (index in open until value.length) {
        when (value[index]) {
            '{' -> depth++
            '}' -> {
                depth--
                if (depth == 0) return index
            }
        }
    }
    return -1
}

private fun replaceScripts(source: String): String {
    val out = StringBuilder(source.length)
    var index = 0
    while (index < source.length) {
        val marker = source[index]
        if (marker != '^' && marker != '_') {
            out.append(marker)
            index++
            continue
        }

        var cursor = index + 1
        while (cursor < source.length && source[cursor].isWhitespace() && source[cursor] != '\n') cursor++
        if (cursor >= source.length) {
            out.append(marker)
            index++
            continue
        }

        val body: String
        val nextIndex: Int
        if (source[cursor] == '{') {
            val close = matchingBrace(source, cursor)
            if (close < 0) {
                out.append(marker)
                index++
                continue
            }
            body = source.substring(cursor + 1, close)
            nextIndex = close + 1
        } else {
            body = source[cursor].toString()
            nextIndex = cursor + 1
        }
        out.append(if (marker == '^') toSuperscript(body) else toSubscript(body))
        index = nextIndex
    }
    return out.toString()
}

private fun stripUnknownCommands(source: String): String {
    val out = StringBuilder(source.length)
    var index = 0
    while (index < source.length) {
        if (source[index] != '\\') {
            out.append(source[index++])
            continue
        }
        if (index + 1 >= source.length) break
        val next = source[index + 1]
        if (!next.isLetter()) {
            if (next != '\\') out.append(next)
            else out.append(' ')
            index += 2
            continue
        }
        index += 2
        while (index < source.length && source[index].isLetter()) index++
    }
    return out.toString()
}

private fun tidyWhitespace(source: String): String {
    val out = StringBuilder(source.length)
    var lastWasSpace = false
    var consecutiveNewlines = 0
    source.forEach { char ->
        when (char) {
            ' ', '\t' -> {
                if (!lastWasSpace && consecutiveNewlines == 0) out.append(' ')
                lastWasSpace = true
            }
            '\n' -> {
                while (out.isNotEmpty() && out.last() == ' ') out.setLength(out.length - 1)
                if (consecutiveNewlines < 2) out.append('\n')
                consecutiveNewlines++
                lastWasSpace = false
            }
            else -> {
                out.append(char)
                lastWasSpace = false
                consecutiveNewlines = 0
            }
        }
    }
    return out.toString().trim()
}

private fun toSuperscript(value: String): String = value.map { char ->
    when (char) {
        '0' -> '⁰'; '1' -> '¹'; '2' -> '²'; '3' -> '³'; '4' -> '⁴'; '5' -> '⁵'
        '6' -> '⁶'; '7' -> '⁷'; '8' -> '⁸'; '9' -> '⁹'; '+' -> '⁺'; '-' -> '⁻'
        '=' -> '⁼'; '(' -> '⁽'; ')' -> '⁾'; 'n' -> 'ⁿ'; 'i' -> 'ⁱ'; else -> char
    }
}.joinToString("")

private fun toSubscript(value: String): String = value.map { char ->
    when (char) {
        '0' -> '₀'; '1' -> '₁'; '2' -> '₂'; '3' -> '₃'; '4' -> '₄'; '5' -> '₅'
        '6' -> '₆'; '7' -> '₇'; '8' -> '₈'; '9' -> '₉'; '+' -> '₊'; '-' -> '₋'
        '=' -> '₌'; '(' -> '₍'; ')' -> '₎'; 'a' -> 'ₐ'; 'e' -> 'ₑ'; 'h' -> 'ₕ'
        'i' -> 'ᵢ'; 'j' -> 'ⱼ'; 'k' -> 'ₖ'; 'l' -> 'ₗ'; 'm' -> 'ₘ'; 'n' -> 'ₙ'
        'o' -> 'ₒ'; 'p' -> 'ₚ'; 'r' -> 'ᵣ'; 's' -> 'ₛ'; 't' -> 'ₜ'; 'u' -> 'ᵤ'; 'v' -> 'ᵥ'; 'x' -> 'ₓ'
        else -> char
    }
}.joinToString("")
