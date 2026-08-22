package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * CPS exam host. Heavy math typesetting is prepared as static server-rendered PNGs before the exam
 * becomes visible. The running exam itself is native Compose only: no WebView, JavaScript or TeX
 * engine is created while the user scrolls.
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

    override fun onResume() {
        super.onResume()
        NativeCapturePolicy.refreshNow(this, FirebaseAuth.getInstance().currentUser)
    }

    companion object {
        private const val EXTRA_COURSE_ID = "cps_exam_course_id"
        private const val EXTRA_EXAM_ID = "cps_exam_id"

        fun open(context: Context, courseId: String, examId: String) {
            if (courseId.isBlank() || examId.isBlank()) return
            runCatching {
                context.startActivity(
                    Intent(context, NativeCpsExamSafeActivity::class.java)
                        .putExtra(EXTRA_COURSE_ID, courseId)
                        .putExtra(EXTRA_EXAM_ID, examId),
                )
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

private data class LoadedSafeExam(
    val payload: NativeCpsExamPayload,
    val questions: List<SafeCpsQuestion>,
    val title: String,
    val resources: CpsPreparedResources,
)

private enum class ExamPage { EXAM, CONFIRM, RESULT, DETAILS }

@Composable
private fun CpsStableExamScreen(courseId: String, examId: String, onBack: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val repository = remember(context) { NativeCpsRepository(context.applicationContext) }
    val resultRepository = remember(context) { NativeCpsExamResultRepository(context.applicationContext) }
    val preloader = remember(context) { CpsExamAssetPreloader(context.applicationContext) }

    var loaded by remember(courseId, examId) { mutableStateOf<LoadedSafeExam?>(null) }
    var loading by remember(courseId, examId) { mutableStateOf(true) }
    var progress by remember(courseId, examId) {
        mutableStateOf(ExamPreparationProgress(percent = 2, status = "Loading exam data…"))
    }
    var error by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var submitted by remember(courseId, examId) { mutableStateOf(false) }
    var page by remember(courseId, examId) { mutableStateOf(ExamPage.EXAM) }
    var startedAtMs by remember(courseId, examId) { mutableLongStateOf(0L) }
    var remainingSeconds by remember(courseId, examId) { mutableIntStateOf(0) }
    var saveStarted by remember(courseId, examId) { mutableStateOf(false) }
    var saveMessage by remember(courseId, examId) { mutableStateOf<String?>(null) }
    val answers = remember(courseId, examId) { mutableStateMapOf<String, Int>() }

    LaunchedEffect(courseId, examId) {
        loading = true
        error = null
        page = ExamPage.EXAM
        val outcome = runCatching {
            progress = ExamPreparationProgress(percent = 4, status = "Loading questions…")
            val payload = repository.loadExam(courseId, examId)
            val questionTotal = payload.questions.size
            val rows = ArrayList<SafeCpsQuestion>(questionTotal)
            payload.questions.forEachIndexed { index, question ->
                rows += runCatching { question.toSafe(index) }.getOrElse { question.toFallback(index) }
                progress = ExamPreparationProgress(
                    percent = 8 + (((index + 1) * 20.0) / questionTotal.coerceAtLeast(1)).roundToInt(),
                    status = "Preparing questions — ${index + 1}/$questionTotal",
                    questionsDone = index + 1,
                    questionsTotal = questionTotal,
                )
            }

            val optionTexts = rows.flatMap { it.options }
            val imageUrls = buildList {
                rows.forEach { row ->
                    if (row.imageUrl.isNotBlank()) add(row.imageUrl)
                    addAll(row.optionImages.filter(String::isNotBlank))
                }
            }
            val resources = preloader.prepare(
                questionTexts = rows.map { it.text },
                optionTexts = optionTexts,
                explanationTexts = rows.map { it.explanation }.filter(String::isNotBlank),
                imageUrls = imageUrls,
                questionDone = questionTotal,
                questionTotal = questionTotal,
                onProgress = { progress = it },
            )
            LoadedSafeExam(
                payload = payload,
                questions = rows,
                title = rawCpsField(payload.exam.title, 2_000).ifBlank { "Exam" },
                resources = resources,
            )
        }
        outcome.onSuccess { result ->
            loaded = result
            startedAtMs = System.currentTimeMillis()
            remainingSeconds = result.payload.exam.duration.coerceIn(0, 24 * 60) * 60
            progress = progress.copy(percent = 100, status = "Ready")
        }.onFailure { throwable ->
            error = throwable.message?.take(300)?.ifBlank { null }
                ?: "Exam questions could not be prepared"
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
        if (!submitted && remainingSeconds == 0) {
            submitted = true
            page = ExamPage.RESULT
        }
    }

    val current = loaded
    val questions = current?.questions.orEmpty()
    val correct = questions.count { q ->
        answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] == q.correctIndex
    }
    val wrong = questions.count { q ->
        answers[q.key] != null && q.correctIndex in q.options.indices && answers[q.key] != q.correctIndex
    }
    val answered = questions.count { answers.containsKey(it.key) }
    val unanswered = (questions.size - answered).coerceAtLeast(0)
    val maxScore = current?.payload?.exam?.maxScore?.takeIf { it.isFinite() && it > 0.0 }
        ?: questions.size.toDouble()
    val perCorrect = if (questions.isNotEmpty()) maxScore / questions.size else 0.0
    val negative = current?.payload?.exam?.negativeMarks?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
    val marks = (correct * perCorrect - wrong * negative).coerceAtLeast(0.0)

    LaunchedEffect(submitted, current?.payload?.exam?.id, questions.size) {
        val exam = current ?: return@LaunchedEffect
        if (!submitted || saveStarted || questions.isEmpty()) return@LaunchedEffect
        saveStarted = true
        val elapsed = if (startedAtMs > 0L) {
            ((System.currentTimeMillis() - startedAtMs) / 1000L).toInt().coerceAtLeast(0)
        } else 0
        val rows = questions.map { q ->
            val selected = answers[q.key] ?: -1
            NativeCpsExamAnswerResult(
                q.sourceId,
                selected,
                q.correctIndex,
                selected >= 0 && q.correctIndex in q.options.indices && selected == q.correctIndex,
            )
        }
        runCatching {
            resultRepository.save(
                NativeCpsExamResultDraft(
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
                ),
            )
        }.onSuccess { saveMessage = "Result saved to your profile" }
            .onFailure { saveMessage = "Result is ready; profile sync can be retried later." }
    }

    BackHandler(enabled = current != null && page != ExamPage.EXAM) {
        page = when (page) {
            ExamPage.CONFIRM -> ExamPage.EXAM
            ExamPage.DETAILS -> ExamPage.RESULT
            ExamPage.RESULT -> { onBack(); ExamPage.RESULT }
            ExamPage.EXAM -> ExamPage.EXAM
        }
    }

    when {
        loading -> ExamPreparationCard(progress, onBack)
        error != null -> CpsExamError(error.orEmpty(), onBack)
        current == null -> CpsExamError("Exam is unavailable", onBack)
        page == ExamPage.CONFIRM -> SubmitConfirmationScreen(
            title = current.title,
            answered = answered,
            unanswered = unanswered,
            onContinue = { page = ExamPage.EXAM },
            onSubmit = { submitted = true; page = ExamPage.RESULT },
        )
        page == ExamPage.RESULT -> ResultLandingScreen(
            title = current.title,
            answered = answered,
            correct = correct,
            wrong = wrong,
            unanswered = unanswered,
            marks = marks,
            maxScore = maxScore,
            saveMessage = saveMessage,
            onDetails = { page = ExamPage.DETAILS },
            onBack = onBack,
        )
        page == ExamPage.DETAILS -> DetailedResultScreen(
            title = current.title,
            questions = questions,
            answers = answers,
            resources = current.resources,
            onBack = { page = ExamPage.RESULT },
        )
        else -> RunningExamScreen(
            title = current.title,
            durationMinutes = current.payload.exam.duration,
            remainingSeconds = remainingSeconds,
            questions = questions,
            answers = answers,
            resources = current.resources,
            onBack = onBack,
            onSubmit = { page = ExamPage.CONFIRM },
        )
    }
}

@Composable
private fun ExamPreparationCard(progress: ExamPreparationProgress, onBack: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Card(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        ) {
            Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Column(Modifier.weight(1f)) {
                        Text("Preparing your exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("Everything is loaded before the exam opens for smooth scrolling.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                LinearProgressIndicator(
                    progress = { (progress.percent.coerceIn(0, 100) / 100f) },
                    modifier = Modifier.fillMaxWidth().height(9.dp),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(progress.status, style = MaterialTheme.typography.bodyMedium)
                    Text("${progress.percent.coerceIn(0, 100)}%", fontWeight = FontWeight.Bold)
                }
                PreparationRow("Questions", progress.questionsDone, progress.questionsTotal)
                PreparationRow("Options", progress.optionsDone, progress.optionsTotal)
                PreparationRow("Mathematics", progress.mathDone, progress.mathTotal)
                PreparationRow("Images", progress.imagesDone, progress.imagesTotal)
            }
        }
    }
}

@Composable
private fun PreparationRow(label: String, done: Int, total: Int) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        val complete = total > 0 && done >= total
        if (complete) Icon(Icons.Default.CheckCircle, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
        else Icon(Icons.Default.Schedule, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(8.dp))
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(if (total > 0) "$done/$total" else "—", fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun RunningExamScreen(
    title: String,
    durationMinutes: Int,
    remainingSeconds: Int,
    questions: List<SafeCpsQuestion>,
    answers: MutableMap<String, Int>,
    resources: CpsPreparedResources,
    onBack: () -> Unit,
    onSubmit: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        ExamFixedHeader(title, durationMinutes, remainingSeconds, onBack)
        HorizontalDivider()
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            itemsIndexed(questions, key = { index, q -> "${q.key}:$index" }) { index, question ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CpsPreparedText(
                        raw = "${index + 1}. ${question.text}",
                        resources = resources,
                        modifier = Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    if (question.imageUrl.startsWith("http")) {
                        AsyncImage(question.imageUrl, "Question image", Modifier.fillMaxWidth().height(190.dp), contentScale = ContentScale.Fit)
                    }
                    question.options.forEachIndexed { optionIndex, option ->
                        Row(
                            Modifier.fillMaxWidth().clickable { answers[question.key] = optionIndex }.padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = answers[question.key] == optionIndex, onClick = { answers[question.key] = optionIndex })
                            Spacer(Modifier.width(4.dp))
                            Column(Modifier.weight(1f)) {
                                CpsPreparedText(option, resources, Modifier.fillMaxWidth(), MaterialTheme.typography.bodyLarge)
                                question.optionImages.getOrNull(optionIndex)?.takeIf { it.startsWith("http") }?.let { image ->
                                    AsyncImage(image, "Option image", Modifier.fillMaxWidth().height(120.dp), contentScale = ContentScale.Fit)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
            item {
                Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 14.dp), shape = RoundedCornerShape(999.dp)) {
                    Text("Submit exam")
                }
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

@Composable
private fun ExamFixedHeader(title: String, durationMinutes: Int, remainingSeconds: Int, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).padding(horizontal = 4.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("CPS exam", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (durationMinutes > 0) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (remainingSeconds <= 60) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
            ) {
                Row(Modifier.padding(horizontal = 11.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Schedule, null, Modifier.size(17.dp))
                    Spacer(Modifier.width(5.dp))
                    Text(examTimer(remainingSeconds), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun SubmitConfirmationScreen(
    title: String,
    answered: Int,
    unanswered: Int,
    onContinue: () -> Unit,
    onSubmit: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) {
        Text("Submit exam?", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(26.dp))
        Text("Answered $answered", style = MaterialTheme.typography.titleLarge)
        Text("Unanswered $unanswered", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        Button(onClick = onSubmit, Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) { Text("Confirm submit") }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = onContinue, Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) { Text("Continue exam") }
    }
}

@Composable
private fun ResultLandingScreen(
    title: String,
    answered: Int,
    correct: Int,
    wrong: Int,
    unanswered: Int,
    marks: Double,
    maxScore: Double,
    saveMessage: String?,
    onDetails: () -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Exam result", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(24.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            ResultCircle("Answered", answered, MaterialTheme.colorScheme.primaryContainer)
            ResultCircle("Correct", correct, MaterialTheme.colorScheme.tertiaryContainer)
            ResultCircle("Wrong", wrong, MaterialTheme.colorScheme.errorContainer)
        }
        Spacer(Modifier.height(26.dp))
        Text("${examMarks(marks)} / ${examMarks(maxScore)}", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("Marks", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (unanswered > 0) {
            Spacer(Modifier.height(6.dp))
            Text("$unanswered unanswered", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        saveMessage?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.weight(1f))
        Button(onClick = onDetails, Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) { Text("View detailed result") }
        Spacer(Modifier.height(18.dp))
    }
}

@Composable
private fun ResultCircle(label: String, value: Int, color: Color) {
    Surface(modifier = Modifier.size(98.dp), shape = CircleShape, color = color) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(value.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun DetailedResultScreen(
    title: String,
    questions: List<SafeCpsQuestion>,
    answers: Map<String, Int>,
    resources: CpsPreparedResources,
    onBack: () -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val correctBg = if (dark) Color(0xFF17351D) else Color(0xFFE7F6E9)
    val wrongBg = if (dark) Color(0xFF3A171A) else Color(0xFFFFE8EB)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text("Detailed result", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        HorizontalDivider()
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 6.dp)) {
            itemsIndexed(questions, key = { index, q -> "result:${q.key}:$index" }) { index, question ->
                var explanationOpen by remember(question.key) { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    CpsPreparedText("${index + 1}. ${question.text}", resources, Modifier.fillMaxWidth(), MaterialTheme.typography.bodyLarge)
                    if (question.imageUrl.startsWith("http")) {
                        AsyncImage(question.imageUrl, "Question image", Modifier.fillMaxWidth().height(190.dp), contentScale = ContentScale.Fit)
                    }
                    question.options.forEachIndexed { optionIndex, option ->
                        val selected = answers[question.key] == optionIndex
                        val isCorrect = question.correctIndex == optionIndex
                        val isWrongSelection = selected && !isCorrect
                        val background = when {
                            isCorrect -> correctBg
                            isWrongSelection -> wrongBg
                            else -> Color.Transparent
                        }
                        Surface(color = background, shape = RoundedCornerShape(12.dp)) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                when {
                                    isCorrect -> Icon(Icons.Default.Check, "Correct", tint = Color(0xFF2E7D32))
                                    isWrongSelection -> Icon(Icons.Default.Close, "Wrong", tint = Color(0xFFC62828))
                                    else -> Spacer(Modifier.size(24.dp))
                                }
                                Spacer(Modifier.width(8.dp))
                                Column(Modifier.weight(1f)) {
                                    CpsPreparedText(option, resources, Modifier.fillMaxWidth(), MaterialTheme.typography.bodyLarge)
                                    question.optionImages.getOrNull(optionIndex)?.takeIf { it.startsWith("http") }?.let { image ->
                                        AsyncImage(image, "Option image", Modifier.fillMaxWidth().height(120.dp), contentScale = ContentScale.Fit)
                                    }
                                }
                            }
                        }
                    }
                    if (question.explanation.isNotBlank()) {
                        Row(
                            Modifier.fillMaxWidth().clickable { explanationOpen = !explanationOpen }.padding(vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Explanation", Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            Icon(if (explanationOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                        }
                        if (explanationOpen) {
                            CpsPreparedText(
                                question.explanation,
                                resources,
                                Modifier.fillMaxWidth().padding(bottom = 4.dp),
                                MaterialTheme.typography.bodyMedium,
                                MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

private fun NativeCpsQuestion.toSafe(index: Int): SafeCpsQuestion {
    val source = runCatching { id.substringBeforeLast(":$index") }
        .getOrDefault(id)
        .ifBlank { "question-$index" }
        .take(300)
    val safeOptions = options.take(12).map { rawCpsField(it, 4_000).ifBlank { "—" } }
    return SafeCpsQuestion(
        key = "$source:$index",
        sourceId = source,
        text = rawCpsField(question, 16_000).ifBlank { "Question text unavailable" },
        imageUrl = questionImageUrl.trim().take(2_048),
        options = safeOptions,
        optionImages = optionImageUrls.take(12).map { it.trim().take(2_048) },
        correctIndex = correctIndex.takeIf { it in safeOptions.indices } ?: -1,
        explanation = rawCpsField(explanation, 16_000),
    )
}

private fun NativeCpsQuestion.toFallback(index: Int): SafeCpsQuestion {
    val source = id.take(300).ifBlank { "question-$index" }
    val rows = options.take(12).map { rawCpsField(it, 4_000).ifBlank { "—" } }
    return SafeCpsQuestion(
        key = "$source:$index",
        sourceId = source,
        text = rawCpsField(question, 8_000).ifBlank { "Question text unavailable" },
        imageUrl = questionImageUrl.take(2_048),
        options = rows,
        optionImages = optionImageUrls.take(12).map { it.take(2_048) },
        correctIndex = correctIndex.takeIf { it in rows.indices } ?: -1,
        explanation = rawCpsField(explanation, 8_000),
    )
}

/** Length cap + HTML cleanup only. TeX commands remain intact for server rendering. */
private fun rawCpsField(raw: String, maxChars: Int): String = runCatching {
    android.text.Html.fromHtml(raw.take(maxChars), android.text.Html.FROM_HTML_MODE_LEGACY).toString().trim()
}.getOrElse { raw.take(maxChars).trim() }

@Composable
private fun CpsExamError(message: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
            Text(message.take(400), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}

private fun examTimer(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val hours = safe / 3600
    val minutes = (safe % 3600) / 60
    val secs = safe % 60
    return if (hours > 0) "%d:%02d:%02d".format(Locale.US, hours, minutes, secs)
    else "%02d:%02d".format(Locale.US, minutes, secs)
}

private fun examMarks(value: Double): String =
    if (abs(value - value.toInt()) < 0.00001) value.toInt().toString()
    else String.format(Locale.US, "%.2f", value)
