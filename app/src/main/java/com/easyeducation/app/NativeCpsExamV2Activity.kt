package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.Html
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
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.abs

/** CPS exam host that contains malformed source data and renders common TeX commands readably. */
class NativeCpsExamV2Activity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
        val courseId = intent.getStringExtra(EXTRA_COURSE).orEmpty().trim()
        val examId = intent.getStringExtra(EXTRA_EXAM).orEmpty().trim()
        if (courseId.isBlank() || examId.isBlank()) { finish(); return }
        setContent {
            EasyEducationTheme(NativeThemePreferences.mode(this)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    CpsExamV2Screen(courseId, examId, ::finish)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
    }

    companion object {
        private const val EXTRA_COURSE = "cps_exam_v2_course"
        private const val EXTRA_EXAM = "cps_exam_v2_exam"
        fun open(context: Context, courseId: String, examId: String) {
            if (courseId.isBlank() || examId.isBlank()) return
            context.startActivity(Intent(context, NativeCpsExamV2Activity::class.java).putExtra(EXTRA_COURSE, courseId).putExtra(EXTRA_EXAM, examId))
        }
    }
}

private data class CpsExamV2Question(
    val key: String,
    val sourceId: String,
    val text: String,
    val image: String,
    val options: List<String>,
    val optionImages: List<String>,
    val correctIndex: Int,
    val explanation: String,
)

@Composable
private fun CpsExamV2Screen(courseId: String, examId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsRepository(context) }
    val results = remember(context) { NativeCpsExamResultRepository(context) }
    var payload by remember(courseId, examId) { mutableStateOf<NativeCpsExamPayload?>(null) }
    var questions by remember(courseId, examId) { mutableStateOf<List<CpsExamV2Question>>(emptyList()) }
    var loading by remember(courseId, examId) { mutableStateOf(true) }
    var error by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var submitted by remember(courseId, examId) { mutableStateOf(false) }
    var startedAt by remember(courseId, examId) { mutableLongStateOf(0L) }
    var remaining by remember(courseId, examId) { mutableIntStateOf(0) }
    var saving by remember(courseId, examId) { mutableStateOf(false) }
    var saveNote by remember(courseId, examId) { mutableStateOf<String?>(null) }
    val answers = remember(courseId, examId) { mutableStateMapOf<String, Int>() }

    LaunchedEffect(courseId, examId) {
        loading = true
        error = null
        runCatching { repository.loadExam(courseId, examId) }
            .onSuccess { loaded ->
                payload = loaded
                questions = loaded.questions.take(250).mapIndexed { index, q ->
                    val options = q.options.take(12).map { cpsMathReadable(it).ifBlank { "—" } }
                    CpsExamV2Question(
                        key = "${q.id}:$index",
                        sourceId = q.id.ifBlank { "question-$index" },
                        text = cpsMathReadable(q.question).ifBlank { "Question text unavailable" },
                        image = q.questionImageUrl.trim().take(2048),
                        options = options,
                        optionImages = q.optionImageUrls.take(12).map { it.trim().take(2048) },
                        correctIndex = q.correctIndex.takeIf { it in options.indices } ?: -1,
                        explanation = cpsMathReadable(q.explanation),
                    )
                }
                startedAt = System.currentTimeMillis()
                remaining = loaded.exam.duration.coerceIn(0, 24 * 60) * 60
            }
            .onFailure { error = it.message?.take(300)?.ifBlank { null } ?: "Exam questions could not be loaded" }
        loading = false
    }

    LaunchedEffect(payload?.exam?.id, submitted) {
        val duration = payload?.exam?.duration ?: return@LaunchedEffect
        if (duration <= 0 || submitted) return@LaunchedEffect
        while (!submitted && remaining > 0) { delay(1_000); if (!submitted) remaining = (remaining - 1).coerceAtLeast(0) }
        if (!submitted && remaining == 0) submitted = true
    }

    val current = payload
    val correct = questions.count { q -> answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] == q.correctIndex }
    val wrong = questions.count { q -> answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] != q.correctIndex }
    val answered = questions.count { answers.containsKey(it.key) }
    val unanswered = (questions.size - answered).coerceAtLeast(0)
    val maxScore = current?.exam?.maxScore?.takeIf { it.isFinite() && it > 0.0 } ?: questions.size.toDouble()
    val perCorrect = if (questions.isNotEmpty()) maxScore / questions.size else 0.0
    val negative = current?.exam?.negativeMarks?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    val marks = (correct * perCorrect - wrong * negative).coerceAtLeast(0.0)

    LaunchedEffect(submitted, current?.exam?.id, questions.size) {
        val loaded = current ?: return@LaunchedEffect
        if (!submitted || saving || questions.isEmpty()) return@LaunchedEffect
        saving = true
        val elapsed = if (startedAt > 0) ((System.currentTimeMillis() - startedAt) / 1000).toInt().coerceAtLeast(0) else 0
        val rows = questions.map { q ->
            val selected = answers[q.key] ?: -1
            NativeCpsExamAnswerResult(q.sourceId, selected, q.correctIndex, selected >= 0 && q.correctIndex in q.options.indices && selected == q.correctIndex)
        }
        runCatching {
            results.save(
                NativeCpsExamResultDraft(
                    courseId = courseId,
                    courseTitle = "",
                    examId = loaded.exam.id,
                    examTitle = loaded.exam.title,
                    startedAtMs = startedAt,
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
                ),
            )
        }.onSuccess { saveNote = "Result saved to your profile" }.onFailure { saveNote = "Result is ready; profile sync can be retried later." }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        error != null -> CpsExamV2Error(error.orEmpty(), onBack)
        current == null -> CpsExamV2Error("Exam is unavailable", onBack)
        else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Column(Modifier.weight(1f)) { Text(cpsMathReadable(current.exam.title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("CPS exam", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (current.exam.duration > 0 && !submitted) Surface(shape = RoundedCornerShape(999.dp), color = if (remaining <= 60) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Schedule, null, Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text(cpsExamV2Timer(remaining), fontWeight = FontWeight.Bold) }
                    }
                }
            }
            if (questions.isEmpty()) item { CpsExamV2Message("No readable questions are available for this exam.") }
            else {
                itemsIndexed(questions, key = { index, q -> "${q.key}:$index" }) { index, q ->
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape = RoundedCornerShape(16.dp)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("${index + 1}. ${q.text}", fontWeight = FontWeight.SemiBold)
                            if (q.image.startsWith("http")) AsyncImage(q.image, "Question image", Modifier.fillMaxWidth().height(180.dp), contentScale = ContentScale.Fit)
                            q.options.forEachIndexed { optionIndex, option ->
                                Row(Modifier.fillMaxWidth().clickable(enabled = !submitted) { answers[q.key] = optionIndex }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(selected = answers[q.key] == optionIndex, onClick = { if (!submitted) answers[q.key] = optionIndex }, enabled = !submitted)
                                    Spacer(Modifier.width(8.dp)); Column(Modifier.weight(1f)) { Text(option); q.optionImages.getOrNull(optionIndex)?.takeIf { it.startsWith("http") }?.let { AsyncImage(it, "Option image", Modifier.fillMaxWidth().height(110.dp), contentScale = ContentScale.Fit) } }
                                }
                            }
                            if (submitted && q.correctIndex in q.options.indices) {
                                HorizontalDivider()
                                val selected = answers[q.key]
                                Text(if (selected == q.correctIndex) "Correct" else "Correct answer: ${q.options[q.correctIndex]}", color = if (selected == q.correctIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                                if (q.explanation.isNotBlank()) Text(q.explanation, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                item {
                    if (!submitted) Button(onClick = { submitted = true }, enabled = answers.isNotEmpty(), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) { Text("Submit exam") }
                    else Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), shape = RoundedCornerShape(18.dp)) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null); Spacer(Modifier.width(8.dp)); Text("Exam result", fontWeight = FontWeight.Bold) }; Text("Marks: ${cpsExamV2Marks(marks)} / ${cpsExamV2Marks(maxScore)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold); Text("Correct $correct • Wrong $wrong • Unanswered $unanswered"); saveNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) } }
                    }
                }
            }
            item { Spacer(Modifier.height(18.dp)) }
        }
    }
}

@Composable private fun CpsExamV2Error(message: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }; CpsExamV2Message(message) }
}
@Composable private fun CpsExamV2Message(text: String) { Card(border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Text(text, Modifier.fillMaxWidth().padding(16.dp)) } }

private fun cpsMathReadable(raw: String): String {
    var value = raw.take(20_000)
        .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
    value = runCatching { Html.fromHtml(value, Html.FROM_HTML_MODE_LEGACY).toString() }.getOrDefault(value)
    repeat(5) {
        value = value.replace(Regex("""\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)}""")) { it.groupValues[1] }
        value = value.replace(Regex("""\\frac\s*\{([^{}]+)}\s*\{([^{}]+)}""")) { "(${it.groupValues[1]})/(${it.groupValues[2]})" }
        value = value.replace(Regex("""\\sqrt\s*\{([^{}]+)}""")) { "√(${it.groupValues[1]})" }
    }
    val symbols = linkedMapOf(
        "lambda" to "λ", "alpha" to "α", "beta" to "β", "gamma" to "γ", "delta" to "δ", "theta" to "θ", "pi" to "π", "mu" to "μ", "sigma" to "σ", "omega" to "ω", "phi" to "φ", "rho" to "ρ", "epsilon" to "ε", "infty" to "∞",
        "times" to "×", "cdot" to "·", "div" to "÷", "pm" to "±", "le" to "≤", "leq" to "≤", "ge" to "≥", "geq" to "≥", "neq" to "≠", "approx" to "≈",
    )
    symbols.forEach { (token, glyph) -> value = value.replace(Regex("""\\$token\b""", RegexOption.IGNORE_CASE), glyph).replace(Regex("""\{?$token\}?""", RegexOption.IGNORE_CASE), glyph) }
    listOf("sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim").forEach { fn -> value = value.replace(Regex("""\\$fn\b""", RegexOption.IGNORE_CASE), fn) }
    value = value.replace("\\left", "").replace("\\right", "").replace("\\,", " ").replace("\\;", " ").replace("\\!", "").replace("$", "")
    value = value.replace(Regex("""\^\{?2}?"""), "²").replace(Regex("""\^\{?3}?"""), "³")
    val subs = mapOf('0' to '₀','1' to '₁','2' to '₂','3' to '₃','4' to '₄','5' to '₅','6' to '₆','7' to '₇','8' to '₈','9' to '₉')
    value = value.replace(Regex("""_\{?([0-9])}?""")) { subs[it.groupValues[1][0]].toString() }
    value = value.replace(Regex("""\{([^{}]+)}""")) { it.groupValues[1] }
    value = value.replace(Regex("[ \\t]+"), " ")
    return value.trim()
}
private fun cpsExamV2Timer(seconds: Int): String { val s = seconds.coerceAtLeast(0); val h=s/3600; val m=(s%3600)/60; val r=s%60; return if(h>0) "%d:%02d:%02d".format(h,m,r) else "%02d:%02d".format(m,r) }
private fun cpsExamV2Marks(v: Double): String = if (abs(v - v.toInt()) < 0.00001) v.toInt().toString() else String.format(Locale.US, "%.2f", v)
