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
 * Crash-contained CPS exam host. It deliberately does not use a navigation path with encoded CPS
 * ids and it sanitizes every question before Compose receives it. A malformed CPS question becomes
 * a readable card instead of terminating the Easy Education process.
 */
class NativeCpsExamSafeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        NativeCapturePolicy.applyCached(this, FirebaseAuth.getInstance().currentUser)
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)

        val courseId = intent.getStringExtra(EXTRA_COURSE_ID).orEmpty().trim()
        val examId = intent.getStringExtra(EXTRA_EXAM_ID).orEmpty().trim()
        if (courseId.isBlank() || examId.isBlank()) {
            finish()
            return
        }
        setContent {
            EasyEducationTheme(NativeThemePreferences.mode(this)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    CpsSafeExamScreen(courseId = courseId, examId = examId, onBack = ::finish)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
    }

    companion object {
        private const val EXTRA_COURSE_ID = "cps_exam_course_id"
        private const val EXTRA_EXAM_ID = "cps_exam_id"

        fun open(context: Context, courseId: String, examId: String) {
            if (courseId.isBlank() || examId.isBlank()) return
            context.startActivity(
                Intent(context, NativeCpsExamSafeActivity::class.java)
                    .putExtra(EXTRA_COURSE_ID, courseId)
                    .putExtra(EXTRA_EXAM_ID, examId),
            )
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

@Composable
private fun CpsSafeExamScreen(courseId: String, examId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsRepository(context) }
    val resultRepository = remember(context) { NativeCpsExamResultRepository(context) }
    var payload by remember(courseId, examId) { mutableStateOf<NativeCpsExamPayload?>(null) }
    var questions by remember(courseId, examId) { mutableStateOf<List<SafeCpsQuestion>>(emptyList()) }
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
        runCatching { repository.loadExam(courseId, examId) }
            .onSuccess { loaded ->
                payload = loaded
                questions = loaded.questions.mapIndexed { index, q -> q.toSafe(index) }
                startedAtMs = System.currentTimeMillis()
                remainingSeconds = loaded.exam.duration.coerceIn(0, 24 * 60) * 60
            }
            .onFailure { throwable ->
                error = throwable.message?.take(300)?.ifBlank { null } ?: "Exam questions could not be loaded"
            }
        loading = false
    }

    LaunchedEffect(payload?.exam?.id, submitted) {
        val duration = payload?.exam?.duration ?: return@LaunchedEffect
        if (duration <= 0 || submitted) return@LaunchedEffect
        while (!submitted && remainingSeconds > 0) {
            delay(1_000L)
            if (!submitted) remainingSeconds = (remainingSeconds - 1).coerceAtLeast(0)
        }
        if (!submitted && remainingSeconds == 0) submitted = true
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
        if (!submitted || saveStarted || questions.isEmpty()) return@LaunchedEffect
        saveStarted = true
        val elapsed = if (startedAtMs > 0L) ((System.currentTimeMillis() - startedAtMs) / 1000L).toInt().coerceAtLeast(0) else 0
        val sourceByKey = loaded.questions.mapIndexed { index, q -> "${q.id}:$index" to q }.toMap()
        val rows = questions.map { q ->
            val selected = answers[q.key] ?: -1
            val source = sourceByKey[q.key]
            NativeCpsExamAnswerResult(
                questionId = source?.id?.ifBlank { q.sourceId } ?: q.sourceId,
                selectedIndex = selected,
                correctIndex = q.correctIndex,
                isCorrect = selected >= 0 && q.correctIndex in q.options.indices && selected == q.correctIndex,
            )
        }
        runCatching {
            resultRepository.save(
                NativeCpsExamResultDraft(
                    courseId = courseId,
                    courseTitle = "",
                    examId = loaded.exam.id,
                    examTitle = loaded.exam.title,
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
                ),
            )
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
                        Text(safeMath(current.exam.title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text("CPS exam", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (current.exam.duration > 0 && !submitted) {
                        Surface(shape = RoundedCornerShape(999.dp), color = if (remainingSeconds <= 60) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) {
                            Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Schedule, null, Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text(examTimer(remainingSeconds), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            if (questions.isEmpty()) {
                item { CpsExamMessage("No readable questions are available for this exam.") }
            } else {
                itemsIndexed(questions, key = { index, q -> "${q.key}:$index" }) { index, question ->
                    Card(
                        Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("${index + 1}. ${question.text}", fontWeight = FontWeight.SemiBold)
                            if (question.imageUrl.startsWith("http")) {
                                AsyncImage(question.imageUrl, "Question image", Modifier.fillMaxWidth().height(180.dp), contentScale = ContentScale.Fit)
                            }
                            question.options.forEachIndexed { optionIndex, option ->
                                Row(
                                    Modifier.fillMaxWidth().clickable(enabled = !submitted) { answers[question.key] = optionIndex }.padding(vertical = 3.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    RadioButton(
                                        selected = answers[question.key] == optionIndex,
                                        onClick = { if (!submitted) answers[question.key] = optionIndex },
                                        enabled = !submitted,
                                    )
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
                        Button(
                            onClick = { submitted = true },
                            enabled = answers.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(999.dp),
                        ) { Text("Submit exam") }
                    } else {
                        Card(
                            Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                            shape = RoundedCornerShape(18.dp),
                        ) {
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
    val source = id.substringBeforeLast(":$index").ifBlank { "question-$index" }
    val safeOptions = options.take(12).map { safeMath(it).ifBlank { "—" } }
    val safeCorrect = correctIndex.takeIf { it in safeOptions.indices } ?: -1
    return SafeCpsQuestion(
        key = "$source:$index",
        sourceId = source,
        text = safeMath(question).ifBlank { "Question text unavailable" },
        imageUrl = questionImageUrl.trim().take(2048),
        options = safeOptions,
        optionImages = optionImageUrls.take(12).map { it.trim().take(2048) },
        correctIndex = safeCorrect,
        explanation = safeMath(explanation),
    )
}

private fun safeMath(raw: String): String {
    var value = raw.take(16_000)
    val replacements = linkedMapOf(
        "{lambda}" to "λ", "\\lambda" to "λ", "{alpha}" to "α", "\\alpha" to "α",
        "{beta}" to "β", "\\beta" to "β", "{gamma}" to "γ", "\\gamma" to "γ",
        "{delta}" to "δ", "\\delta" to "δ", "{theta}" to "θ", "\\theta" to "θ",
        "{pi}" to "π", "\\pi" to "π", "{mu}" to "μ", "\\mu" to "μ",
        "{sigma}" to "σ", "\\sigma" to "σ", "{omega}" to "ω", "\\omega" to "ω",
        "\\times" to "×", "\\div" to "÷", "\\pm" to "±", "\\leq" to "≤", "\\geq" to "≥",
    )
    replacements.forEach { (from, to) -> value = value.replace(from, to, ignoreCase = true) }
    value = runCatching { android.text.Html.fromHtml(value, android.text.Html.FROM_HTML_MODE_LEGACY).toString() }.getOrDefault(value)
    return value.replace("$", "").replace("\\left", "").replace("\\right", "").trim()
}

@Composable
private fun CpsExamError(message: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Card(border = BorderStroke(1.dp, MaterialTheme.colorScheme.error), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
            Text(message.take(400), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}

@Composable
private fun CpsExamMessage(message: String) {
    Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Text(message, Modifier.padding(18.dp))
    }
}

private fun examTimer(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val hours = safe / 3600
    val minutes = (safe % 3600) / 60
    val secs = safe % 60
    return if (hours > 0) "%d:%02d:%02d".format(Locale.US, hours, minutes, secs) else "%02d:%02d".format(Locale.US, minutes, secs)
}

private fun examMarks(value: Double): String = if (abs(value - value.toInt()) < 0.00001) value.toInt().toString() else String.format(Locale.US, "%.2f", value)
