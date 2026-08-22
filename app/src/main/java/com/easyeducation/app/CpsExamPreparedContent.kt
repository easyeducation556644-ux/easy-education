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

/**
 * Kept as an explicit resource object so the exam renderer can evolve without changing the screen
 * contract. Mathematics is now normalized to native text, therefore opening an exam no longer
 * waits for a TeX/PNG network renderer.
 */
internal data class CpsPreparedResources(
    val renderer: String = "native-fast-math-v2",
)

internal data class CpsPreparedSegment(val math: Boolean, val value: String)

/**
 * Critical-path preparation intentionally does no network math rendering. CPS question/option
 * images are warmed into Coil's memory/disk cache in the background, so they never hold the exam
 * timer hostage. Once Coil has fetched an image it is reused on following opens.
 */
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

        // Prime the tiny native formatter once while the loading surface is still visible. This is
        // CPU-only and completes in milliseconds; there is no server call and no WebView/KaTeX.
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

        // Do not await images. The student gets the exam immediately; Coil persists successful
        // responses in its disk cache and serves the same URLs from cache on later attempts.
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

/**
 * Native lightweight rendering for CPS/HSC-style mathematics. The goal is consistent line height
 * and immediate scrolling, not bitmap typesetting. Common TeX commands are converted to readable
 * Unicode and normal text so equations stay aligned with Bangla/English text instead of appearing
 * as oversized raster islands.
 */
@Composable
internal fun CpsPreparedText(
    raw: String,
    resources: CpsPreparedResources,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = LocalContentColor.current,
) {
    val normalized = remember(raw) { normalizeCpsMathText(raw) }
    Text(
        text = normalized,
        modifier = modifier,
        style = style,
        color = color,
    )
}

internal fun cpsPreparedSegments(input: String): List<CpsPreparedSegment> =
    listOf(CpsPreparedSegment(math = looksLikeMath(input), value = normalizeCpsMathText(input)))

private fun looksLikeMath(value: String): Boolean =
    value.indexOf('\\') >= 0 || value.indexOf('$') >= 0 || value.indexOf('^') >= 0 || value.indexOf('_') >= 0

internal fun normalizeCpsMathText(input: String): String {
    if (input.isBlank()) return input
    var value = input
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace(Regex("(?m)^\\s*#{1,6}\\s*"), "")
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
        value = value
            .replace(Regex("\\\\text\\s*\\{([^{}]*)}"), "$1")
            .replace(Regex("\\\\mathrm\\s*\\{([^{}]*)}"), "$1")
            .replace(Regex("\\\\mathbf\\s*\\{([^{}]*)}"), "$1")
            .replace(Regex("\\\\operatorname\\s*\\{([^{}]*)}"), "$1")
            .replace(Regex("\\\\sqrt\\s*\\{([^{}]*)}")) { match -> "√(${match.groupValues[1]})" }
            .replace(Regex("\\\\frac\\s*\\{([^{}]+)}\\s*\\{([^{}]+)}")) { match ->
                "(${match.groupValues[1]})/(${match.groupValues[2]})"
            }
    }

    val commands = linkedMapOf(
        "\\alpha" to "α", "\\beta" to "β", "\\gamma" to "γ", "\\delta" to "δ",
        "\\epsilon" to "ε", "\\varepsilon" to "ε", "\\zeta" to "ζ", "\\eta" to "η",
        "\\theta" to "θ", "\\vartheta" to "ϑ", "\\iota" to "ι", "\\kappa" to "κ",
        "\\lambda" to "λ", "\\mu" to "μ", "\\nu" to "ν", "\\xi" to "ξ",
        "\\pi" to "π", "\\rho" to "ρ", "\\sigma" to "σ", "\\tau" to "τ",
        "\\phi" to "φ", "\\varphi" to "ϕ", "\\chi" to "χ", "\\psi" to "ψ", "\\omega" to "ω",
        "\\Delta" to "Δ", "\\Theta" to "Θ", "\\Lambda" to "Λ", "\\Pi" to "Π",
        "\\Sigma" to "Σ", "\\Phi" to "Φ", "\\Psi" to "Ψ", "\\Omega" to "Ω",
        "\\times" to "×", "\\cdot" to "·", "\\pm" to "±", "\\mp" to "∓",
        "\\leq" to "≤", "\\le" to "≤", "\\geq" to "≥", "\\ge" to "≥",
        "\\neq" to "≠", "\\approx" to "≈", "\\equiv" to "≡", "\\propto" to "∝",
        "\\infty" to "∞", "\\degree" to "°", "\\circ" to "°",
        "\\rightarrow" to "→", "\\leftarrow" to "←", "\\Rightarrow" to "⇒",
        "\\sin" to "sin", "\\cos" to "cos", "\\tan" to "tan", "\\cot" to "cot",
        "\\sec" to "sec", "\\csc" to "csc", "\\log" to "log", "\\ln" to "ln",
    )
    commands.forEach { (command, replacement) -> value = value.replace(command, replacement) }

    value = value
        .replace(Regex("\\\\vec\\s*\\{([^{}]+)}")) { "${it.groupValues[1]}⃗" }
        .replace(Regex("\\\\hat\\s*\\{([^{}]+)}")) { "${it.groupValues[1]}̂" }
        .replace(Regex("\\\\bar\\s*\\{([^{}]+)}")) { "${it.groupValues[1]}̄" }
        .replace(Regex("\\^\\s*\\{([^{}]+)}")) { toSuperscript(it.groupValues[1]) }
        .replace(Regex("\\^([0-9+\\-=()]+)")) { toSuperscript(it.groupValues[1]) }
        .replace(Regex("_\\s*\\{([^{}]+)}")) { toSubscript(it.groupValues[1]) }
        .replace(Regex("_([0-9+\\-=()]+)")) { toSubscript(it.groupValues[1]) }
        .replace(Regex("\\\\[A-Za-z]+"), "")
        .replace("{", "")
        .replace("}", "")
        .replace(Regex("[ \\t]{2,}"), " ")
        .replace(Regex(" *\\n *"), "\n")
        .trim()

    return value
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
