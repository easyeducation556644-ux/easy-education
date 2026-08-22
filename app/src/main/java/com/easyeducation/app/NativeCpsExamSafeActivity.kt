package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.abs

/**
 * CPS exam host. Network decode, question sanitising and math conversion are all inside one failure
 * boundary so one malformed CPS question can never terminate the Android process.
 */
class NativeCpsExamSafeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        val courseId = intent.getStringExtra(EXTRA_COURSE_ID).orEmpty().trim()
        val examId = intent.getStringExtra(EXTRA_EXAM_ID).orEmpty().trim()
        if (courseId.isBlank() || examId.isBlank()) { finish(); return }
        setContent {
            EasyEducationTheme(NativeThemePreferences.mode(this)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    CpsStableExamScreen(courseId, examId, ::finish)
                }
            }
        }
    }

    companion object {
        private const val EXTRA_COURSE_ID = "cps_exam_course_id"
        private const val EXTRA_EXAM_ID = "cps_exam_id"
        fun open(context: Context, courseId: String, examId: String) {
            if (courseId.isBlank() || examId.isBlank()) return
            runCatching {
                context.startActivity(Intent(context, NativeCpsExamSafeActivity::class.java)
                    .putExtra(EXTRA_COURSE_ID, courseId)
                    .putExtra(EXTRA_EXAM_ID, examId))
            }
        }
    }
}

private data class SafeCpsQuestion(
    val key: String,
    val sourceId: String,
    val text: String,
    val imageUrl: String,
    val options: List<String>,
    val optionImages: List<String>,
    val correctIndex: Int,
    val explanation: String,
)

private data class LoadedSafeExam(val payload: NativeCpsExamPayload, val questions: List<SafeCpsQuestion>, val title: String)

@Composable
private fun CpsStableExamScreen(courseId: String, examId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsRepository(context.applicationContext) }
    val resultRepository = remember(context) { NativeCpsExamResultRepository(context.applicationContext) }
    var loaded by remember(courseId, examId) { mutableStateOf<LoadedSafeExam?>(null) }
    var loading by remember(courseId, examId) { mutableStateOf(true) }
    var error by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var submitted by remember(courseId, examId) { mutableStateOf(false) }
    var startedAtMs by remember(courseId, examId) { mutableLongStateOf(0L) }
    var remainingSeconds by remember(courseId, examId) { mutableIntStateOf(0) }
    var saveStarted by remember(courseId, examId) { mutableStateOf(false) }
    var saveMessage by remember(courseId, examId) { mutableStateOf<String?>(null) }
    val answers = remember(courseId, examId) { mutableStateMapOf<String, Int>() }

    LaunchedEffect(courseId, examId) {
        loading = true
        error = null
        val outcome = runCatching {
            val payload = repository.loadExam(courseId, examId)
            val safeRows = payload.questions.mapIndexed { index, question ->
                runCatching { question.toSafe(index) }.getOrElse { question.toFallback(index) }
            }
            LoadedSafeExam(payload, safeRows, safeFormatCpsMath(payload.exam.title).ifBlank { "Exam" })
        }
        outcome.onSuccess { result ->
            loaded = result
            startedAtMs = System.currentTimeMillis()
            remainingSeconds = result.payload.exam.duration.coerceIn(0, 24 * 60) * 60
        }.onFailure { throwable ->
            error = throwable.message?.take(300)?.ifBlank { null } ?: "Exam questions could not be loaded"
        }
        loading = false
    }

    LaunchedEffect(loaded?.payload?.exam?.id, submitted) {
        val duration = loaded?.payload?.exam?.duration ?: return@LaunchedEffect
        if (duration <= 0 || submitted) return@LaunchedEffect
        while (!submitted && remainingSeconds > 0) {
            delay(1_000L)
            if (!submitted) remainingSeconds = (remainingSeconds - 1).coerceAtLeast(0)
        }
        if (!submitted && remainingSeconds == 0) submitted = true
    }

    val current = loaded
    val questions = current?.questions.orEmpty()
    val correct = questions.count { q -> answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] == q.correctIndex }
    val wrong = questions.count { q -> answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] != q.correctIndex }
    val answered = questions.count { answers.containsKey(it.key) }
    val unanswered = (questions.size - answered).coerceAtLeast(0)
    val maxScore = current?.payload?.exam?.maxScore?.takeIf { it.isFinite() && it > 0.0 } ?: questions.size.toDouble()
    val perCorrect = if (questions.isNotEmpty()) maxScore / questions.size else 0.0
    val negative = current?.payload?.exam?.negativeMarks?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    val marks = (correct * perCorrect - wrong * negative).coerceAtLeast(0.0)

    LaunchedEffect(submitted, current?.payload?.exam?.id, questions.size) {
        val exam = current ?: return@LaunchedEffect
        if (!submitted || saveStarted || questions.isEmpty()) return@LaunchedEffect
        saveStarted = true
        val elapsed = if (startedAtMs > 0L) ((System.currentTimeMillis() - startedAtMs) / 1000L).toInt().coerceAtLeast(0) else 0
        val rows = questions.map { q ->
            val selected = answers[q.key] ?: -1
            NativeCpsExamAnswerResult(q.sourceId, selected, q.correctIndex, selected >= 0 && q.correctIndex in q.options.indices && selected == q.correctIndex)
        }
        runCatching {
            resultRepository.save(NativeCpsExamResultDraft(
                courseId = courseId,
                courseTitle = "",
                examId = exam.payload.exam.id,
                examTitle = exam.payload.exam.title,
                startedAtMs = startedAtMs,
                timeTakenSeconds = elapsed,
                answered = answered,
                correct = correct,
                wrong = wrong,
                unanswered = unanswered,
                marks = marks,
                maxScore = maxScore,
                negativeMarks = negative,
                questionCount = questions.size,
                answers = rows,
            ))
        }.onSuccess { saveMessage = "Result saved to your profile" }
            .onFailure { saveMessage = "Result is ready; profile sync can be retried later." }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        error != null -> CpsExamError(error.orEmpty(), onBack)
        current == null -> CpsExamError("Exam is unavailable", onBack)
        else -> LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Column(Modifier.weight(1f)) {
                        Text(current.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text("CPS exam", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (current.payload.exam.duration > 0 && !submitted) {
                        Surface(shape = RoundedCornerShape(999.dp), color = if (remainingSeconds <= 60) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) {
                            Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Schedule, null, Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text(examTimer(remainingSeconds), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
            if (questions.isEmpty()) item { CpsExamMessage("No readable questions are available for this exam.") }
            else {
                itemsIndexed(questions, key = { index, q -> "${q.key}:$index" }) { index, question ->
                    Card(
                        Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("${index + 1}. ${question.text}", fontWeight = FontWeight.SemiBold)
                            if (question.imageUrl.startsWith("http")) AsyncImage(question.imageUrl, "Question image", Modifier.fillMaxWidth().height(180.dp), contentScale = ContentScale.Fit)
                            question.options.forEachIndexed { optionIndex, option ->
                                Row(
                                    Modifier.fillMaxWidth().clickable(enabled = !submitted) { answers[question.key] = optionIndex }.padding(vertical = 3.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    RadioButton(selected = answers[question.key] == optionIndex, onClick = { if (!submitted) answers[question.key] = optionIndex }, enabled = !submitted)
                                    Spacer(Modifier.width(8.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(option)
                                        question.optionImages.getOrNull(optionIndex)?.takeIf { it.startsWith("http") }?.let { image ->
                                            AsyncImage(image, "Option image", Modifier.fillMaxWidth().height(110.dp), contentScale = ContentScale.Fit)
                                        }
                                    }
                                }
                            }
                            if (submitted && question.correctIndex in question.options.indices) {
                                HorizontalDivider()
                                val selected = answers[question.key]
                                Text(
                                    if (selected == question.correctIndex) "Correct" else "Correct answer: ${question.options[question.correctIndex]}",
                                    color = if (selected == question.correctIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                if (question.explanation.isNotBlank()) Text(question.explanation, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                item {
                    if (!submitted) {
                        Button(onClick = { submitted = true }, enabled = answers.isNotEmpty(), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) { Text("Submit exam") }
                    } else {
                        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), shape = RoundedCornerShape(18.dp)) {
                            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null); Spacer(Modifier.width(8.dp)); Text("Exam result", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                                Text("Marks: ${examMarks(marks)} / ${examMarks(maxScore)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                                Text("Correct $correct • Wrong $wrong • Unanswered $unanswered")
                                saveMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(18.dp)) }
        }
    }
}

private fun NativeCpsQuestion.toSafe(index: Int): SafeCpsQuestion {
    val source = runCatching { id.substringBeforeLast(":$index") }.getOrDefault(id).ifBlank { "question-$index" }.take(300)
    val safeOptions = options.take(12).map { safeFormatCpsMath(it).ifBlank { "—" } }
    return SafeCpsQuestion(
        key = "$source:$index",
        sourceId = source,
        text = safeFormatCpsMath(question).ifBlank { "Question text unavailable" },
        imageUrl = questionImageUrl.trim().take(2048),
        options = safeOptions,
        optionImages = optionImageUrls.take(12).map { it.trim().take(2048) },
        correctIndex = correctIndex.takeIf { it in safeOptions.indices } ?: -1,
        explanation = safeFormatCpsMath(explanation),
    )
}

private fun NativeCpsQuestion.toFallback(index: Int): SafeCpsQuestion {
    val source = id.take(300).ifBlank { "question-$index" }
    val rows = options.take(12).map { it.take(4_000).ifBlank { "—" } }
    return SafeCpsQuestion("$source:$index", source, question.take(8_000).ifBlank { "Question text unavailable" }, questionImageUrl.take(2048), rows, optionImageUrls.take(12).map { it.take(2048) }, correctIndex.takeIf { it in rows.indices } ?: -1, explanation.take(8_000))
}

/** Never throws: CPS uses bare LaTeX commands mixed with Bengali/English prose. */
private fun safeFormatCpsMath(raw: String): String = runCatching { formatCpsMath(raw) }
    .getOrElse { raw.take(16_000).replace("$", "").trim() }

private fun formatCpsMath(raw: String): String {
    var value = android.text.Html.fromHtml(raw.take(16_000), android.text.Html.FROM_HTML_MODE_LEGACY).toString()
        .replace("$", "").replace("\\left", "").replace("\\right", "")
    repeat(6) {
        value = value.replace(Regex("\\\\(?:text|mathrm|mathbf|operatorname)\\s*\\{([^{}]*)}")) { it.groupValues[1] }
        value = value.replace(Regex("\\\\frac\\s*\\{([^{}]+)}\\s*\\{([^{}]+)}")) { m -> "${mathGroup(m.groupValues[1])}⁄${mathGroup(m.groupValues[2])}" }
        value = value.replace(Regex("\\\\sqrt\\s*\\{([^{}]+)}")) { m -> "√(${m.groupValues[1]})" }
    }
    val commands = linkedMapOf(
        "lambda" to "λ", "alpha" to "α", "beta" to "β", "gamma" to "γ", "delta" to "δ", "theta" to "θ", "pi" to "π", "mu" to "μ", "sigma" to "σ", "omega" to "ω", "phi" to "φ", "rho" to "ρ", "epsilon" to "ε",
        "infty" to "∞", "times" to "×", "div" to "÷", "pm" to "±", "le" to "≤", "leq" to "≤", "ge" to "≥", "geq" to "≥", "neq" to "≠", "approx" to "≈", "cdot" to "·", "rightarrow" to "→", "leftarrow" to "←", "degree" to "°",
        "sin" to "sin", "cos" to "cos", "tan" to "tan", "cot" to "cot", "sec" to "sec", "csc" to "csc", "log" to "log", "ln" to "ln", "exp" to "exp",
    )
    commands.forEach { (name, symbol) -> value = value.replace(Regex("\\\\$name\\b", RegexOption.IGNORE_CASE), symbol) }
    return value
        .replace(Regex("\\^\\{([0-9+\\-=()]+)}")) { toSuperscript(it.groupValues[1]) }
        .replace(Regex("\\^([0-9+-])")) { toSuperscript(it.groupValues[1]) }
        .replace(Regex("_\\{([0-9+\\-=()]+)}")) { toSubscript(it.groupValues[1]) }
        .replace(Regex("_([0-9+-])")) { toSubscript(it.groupValues[1]) }
        .replace(Regex("\\\\[,;!:]"), " ")
        .replace(Regex("\\\\([A-Za-z]+)")) { it.groupValues[1] }
        .replace("{", "").replace("}", "")
        .replace(Regex("[ \\t]+"), " ")
        .replace(Regex(" *\\n *"), "\n")
        .trim()
}

private fun mathGroup(value: String): String = if (value.any { it.isWhitespace() || it in "+-=" }) "(${value.trim()})" else value.trim()
private fun toSuperscript(value: String): String = value.map { when (it) { '0' -> '⁰'; '1' -> '¹'; '2' -> '²'; '3' -> '³'; '4' -> '⁴'; '5' -> '⁵'; '6' -> '⁶'; '7' -> '⁷'; '8' -> '⁸'; '9' -> '⁹'; '+' -> '⁺'; '-' -> '⁻'; '=' -> '⁼'; '(' -> '⁽'; ')' -> '⁾'; else -> it } }.joinToString("")
private fun toSubscript(value: String): String = value.map { when (it) { '0' -> '₀'; '1' -> '₁'; '2' -> '₂'; '3' -> '₃'; '4' -> '₄'; '5' -> '₅'; '6' -> '₆'; '7' -> '₇'; '8' -> '₈'; '9' -> '₉'; '+' -> '₊'; '-' -> '₋'; '=' -> '₌'; '(' -> '₍'; ')' -> '₎'; else -> it } }.joinToString("")

@Composable
private fun CpsExamError(message: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
        Card(border = BorderStroke(1.dp, MaterialTheme.colorScheme.error), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) { Text(message.take(400), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer) }
    }
}

@Composable private fun CpsExamMessage(message: String) { Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Text(message, Modifier.padding(18.dp)) } }
private fun examTimer(seconds: Int): String { val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = (safe % 3600) / 60; val s = safe % 60; return if (h > 0) "%d:%02d:%02d".format(Locale.US, h, m, s) else "%02d:%02d".format(Locale.US, m, s) }
private fun examMarks(value: Double): String = if (abs(value - value.toInt()) < 0.00001) value.toInt().toString() else String.format(Locale.US, "%.2f", value)
