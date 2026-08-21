package com.easyeducation.app

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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LiveTv
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
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun NativeCpsLiveClassCard(item: NativeCpsLiveClass) {
    val context = LocalContext.current
    val joinable = item.hasAccess && item.url.startsWith("http", ignoreCase = true)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = joinable) {
            NativeCpsLivePlayerActivity.openLive(context, item.title, item.url, item.id)
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Icon(Icons.Default.LiveTv, null, Modifier.padding(10.dp).size(24.dp), tint = MaterialTheme.colorScheme.onErrorContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOf(item.status, item.startTime, item.platform).filter { it.isNotBlank() }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.topic.isNotBlank() && item.topic != item.title) {
                    Text(item.topic, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Text(if (joinable) "Join" else "Locked", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun NativeCpsExamCard(item: NativeCpsExamSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Icon(Icons.Default.Event, null, Modifier.padding(10.dp).size(24.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val pieces = buildList {
                    item.status.takeIf { it.isNotBlank() }?.let(::add)
                    if (item.duration > 0) add("${item.duration} min")
                    if (item.questionsCount > 0) add("${item.questionsCount} questions")
                }
                if (pieces.isNotEmpty()) Text(pieces.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("Start ›", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun NativeCpsExamScreen(nav: NavHostController, courseId: String, examId: String) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsRepository(context) }
    val resultRepository = remember(context) { NativeCpsExamResultRepository(context) }
    var payload by remember(courseId, examId) { mutableStateOf<NativeCpsExamPayload?>(null) }
    var loading by remember(courseId, examId) { mutableStateOf(true) }
    var error by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var submitted by remember(courseId, examId) { mutableStateOf(false) }
    var saveStarted by remember(courseId, examId) { mutableStateOf(false) }
    var saveMessage by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var startedAtMs by remember(courseId, examId) { mutableLongStateOf(0L) }
    var remainingSeconds by remember(courseId, examId) { mutableIntStateOf(0) }
    val answers = remember(courseId, examId) { mutableStateMapOf<String, Int>() }

    LaunchedEffect(courseId, examId) {
        loading = true
        error = null
        runCatching { repository.loadExam(courseId, examId) }
            .onSuccess { loaded ->
                payload = loaded
                startedAtMs = System.currentTimeMillis()
                remainingSeconds = loaded.exam.duration.coerceAtLeast(0) * 60
            }
            .onFailure { error = it.message ?: "Exam questions could not be loaded" }
        loading = false
    }

    LaunchedEffect(payload, submitted) {
        val exam = payload?.exam ?: return@LaunchedEffect
        if (exam.duration <= 0 || submitted) return@LaunchedEffect
        while (!submitted && remainingSeconds > 0) {
            delay(1_000L)
            if (!submitted) remainingSeconds = (remainingSeconds - 1).coerceAtLeast(0)
        }
        if (!submitted && remainingSeconds == 0) submitted = true
    }

    val current = payload
    val questions = current?.questions.orEmpty()
    val correct = questions.count { q -> answers[q.id] != null && q.correctIndex >= 0 && answers[q.id] == q.correctIndex }
    val wrong = questions.count { q -> answers[q.id] != null && q.correctIndex >= 0 && answers[q.id] != q.correctIndex }
    val answered = answers.size
    val unanswered = (questions.size - answered).coerceAtLeast(0)
    val perCorrect = if ((current?.exam?.maxScore ?: 0.0) > 0.0 && questions.isNotEmpty()) current!!.exam.maxScore / questions.size else 1.0
    val marks = (correct * perCorrect - wrong * (current?.exam?.negativeMarks ?: 0.0)).coerceAtLeast(0.0)

    LaunchedEffect(submitted, current) {
        val examPayload = current ?: return@LaunchedEffect
        if (!submitted || saveStarted || questions.isEmpty()) return@LaunchedEffect
        saveStarted = true
        val elapsed = if (startedAtMs > 0L) ((System.currentTimeMillis() - startedAtMs) / 1000L).toInt().coerceAtLeast(0) else 0
        val answerRows = questions.map { q ->
            val selected = answers[q.id] ?: -1
            NativeCpsExamAnswerResult(
                questionId = q.id,
                selectedIndex = selected,
                correctIndex = q.correctIndex,
                isCorrect = selected >= 0 && q.correctIndex >= 0 && selected == q.correctIndex,
            )
        }
        runCatching {
            resultRepository.save(
                NativeCpsExamResultDraft(
                    courseId = courseId,
                    courseTitle = "",
                    examId = examPayload.exam.id,
                    examTitle = examPayload.exam.title,
                    startedAtMs = startedAtMs,
                    timeTakenSeconds = elapsed,
                    answered = answered,
                    correct = correct,
                    wrong = wrong,
                    unanswered = unanswered,
                    marks = marks,
                    maxScore = examPayload.exam.maxScore,
                    negativeMarks = examPayload.exam.negativeMarks,
                    questionCount = questions.size,
                    answers = answerRows,
                ),
            )
        }.onSuccess { saveMessage = "Result saved to your profile" }
            .onFailure { saveMessage = "Result will stay on this screen; profile sync failed." }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        error != null -> ExamError(nav, error.orEmpty())
        current == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Exam is unavailable") }
        else -> {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                        Column(Modifier.weight(1f)) {
                            NativeMathText(current.exam.title, fontWeight = FontWeight.Bold, title = true)
                            Text("Answers and result are saved only to Easy Education — CPS stays read-only.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (current.exam.duration > 0 && !submitted) {
                            Surface(shape = RoundedCornerShape(999.dp), color = if (remainingSeconds <= 60) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) {
                                Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Schedule, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text(formatExamTimer(remainingSeconds), fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
                if (questions.isEmpty()) {
                    item { Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Text("No readable questions are available for this exam.", Modifier.padding(18.dp)) } }
                } else {
                    itemsIndexed(questions, key = { _, item -> item.id }) { index, question ->
                        Card(
                            Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            shape = RoundedCornerShape(16.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(verticalAlignment = Alignment.Top) {
                                    Text("${index + 1}. ", fontWeight = FontWeight.Bold)
                                    NativeMathText(question.question, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                }
                                if (question.questionImageUrl.isNotBlank()) {
                                    AsyncImage(question.questionImageUrl, "Question image", Modifier.fillMaxWidth().height(180.dp), contentScale = ContentScale.Fit)
                                }
                                question.options.forEachIndexed { optionIndex, option ->
                                    Row(
                                        Modifier.fillMaxWidth().clickable(enabled = !submitted) { answers[question.id] = optionIndex }.padding(vertical = 3.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(selected = answers[question.id] == optionIndex, onClick = { if (!submitted) answers[question.id] = optionIndex }, enabled = !submitted)
                                        Spacer(Modifier.width(8.dp))
                                        Column(Modifier.weight(1f)) {
                                            NativeMathText(option)
                                            question.optionImageUrls.getOrNull(optionIndex)?.takeIf { it.isNotBlank() }?.let { image ->
                                                AsyncImage(image, "Option image", Modifier.fillMaxWidth().height(110.dp), contentScale = ContentScale.Fit)
                                            }
                                        }
                                    }
                                }
                                if (submitted && question.correctIndex >= 0) {
                                    HorizontalDivider()
                                    val selected = answers[question.id]
                                    Text(
                                        if (selected == question.correctIndex) "Correct" else "Correct answer:",
                                        color = if (selected == question.correctIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    if (selected != question.correctIndex) NativeMathText(question.options.getOrNull(question.correctIndex).orEmpty(), fontWeight = FontWeight.Bold)
                                    if (question.explanation.isNotBlank()) NativeMathText(question.explanation)
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
                                    Text("Marks: ${formatMarks(marks)} / ${formatMarks(current.exam.maxScore.takeIf { it > 0.0 } ?: questions.size.toDouble())}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                                    Text("Correct $correct • Wrong $wrong • Unanswered $unanswered")
                                    saveMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f)) }
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
fun NativeExamHistoryScreen(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsExamResultRepository(context) }
    var results by remember { mutableStateOf(repository.cached()) }
    var loading by remember { mutableStateOf(results.isEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { repository.refresh() }
            .onSuccess { results = it; error = null }
            .onFailure { error = it.message }
        loading = false
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text("Exam Results", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Your CPS exam history", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        }
        error?.takeIf { results.isEmpty() }?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        if (!loading && results.isEmpty()) {
            item {
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.History, null, Modifier.size(34.dp)); Spacer(Modifier.height(8.dp)); Text("No exam result yet", fontWeight = FontWeight.Bold)
                        Text("Finish a CPS exam and the result will appear here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            items(results, key = { it.id }) { result ->
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        NativeMathText(result.examTitle, fontWeight = FontWeight.Bold)
                        if (result.courseTitle.isNotBlank()) Text(result.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${formatMarks(result.marks)} / ${formatMarks(result.maxScore.takeIf { it > 0.0 } ?: result.questionCount.toDouble())}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
                        Text("Correct ${result.correct} • Wrong ${result.wrong} • Unanswered ${result.unanswered}", style = MaterialTheme.typography.bodySmall)
                        if (result.submittedAtMs > 0L) Text(formatExamDate(result.submittedAtMs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun ExamError(nav: NavHostController, message: String) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Card(border = BorderStroke(1.dp, MaterialTheme.colorScheme.error), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
            Text(message, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}

@Composable
private fun NativeMathText(raw: String, modifier: Modifier = Modifier, fontWeight: FontWeight? = null, title: Boolean = false) {
    Text(normalizeCpsMath(raw), modifier, style = if (title) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyLarge, fontWeight = fontWeight)
}

private fun normalizeCpsMath(raw: String): String {
    var value = raw
        .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")

    val symbols = linkedMapOf(
        "lambda" to "λ", "alpha" to "α", "beta" to "β", "gamma" to "γ", "delta" to "δ",
        "theta" to "θ", "pi" to "π", "mu" to "μ", "sigma" to "σ", "omega" to "ω",
        "phi" to "φ", "rho" to "ρ", "epsilon" to "ε", "infty" to "∞",
        "times" to "×", "div" to "÷", "pm" to "±", "le" to "≤", "leq" to "≤",
        "ge" to "≥", "geq" to "≥", "neq" to "≠", "approx" to "≈", "cdot" to "·",
    )
    symbols.forEach { (token, glyph) ->
        value = value.replace("\\$token", glyph, ignoreCase = true)
        value = value.replace(Regex("\\{?$token\\}?", RegexOption.IGNORE_CASE), glyph)
    }
    repeat(4) {
        value = value.replace(Regex("\\\\frac\\s*\\{([^{}]+)}\\s*\\{([^{}]+)}")) { m -> "(${m.groupValues[1]})/(${m.groupValues[2]})" }
        value = value.replace(Regex("\\\\sqrt\\s*\\{([^{}]+)}")) { m -> "√(${m.groupValues[1]})" }
    }
    value = value
        .replace("\\left", "")
        .replace("\\right", "")
        .replace("\\,", " ")
        .replace("\\;", " ")
        .replace(36.toChar().toString(), "")
        .replace(Regex("\\^\\{?2\\}?"), "²")
        .replace(Regex("\\^\\{?3\\}?"), "³")
        .replace(Regex("_\\{?0\\}?"), "₀")
        .replace(Regex("_\\{?1\\}?"), "₁")
        .replace(Regex("_\\{?2\\}?"), "₂")
        .replace(Regex("_\\{?3\\}?"), "₃")
        .replace(Regex("_\\{?4\\}?"), "₄")
        .replace(Regex("_\\{?5\\}?"), "₅")
        .replace(Regex("_\\{?6\\}?"), "₆")
        .replace(Regex("_\\{?7\\}?"), "₇")
        .replace(Regex("_\\{?8\\}?"), "₈")
        .replace(Regex("_\\{?9\\}?"), "₉")
        .replace(Regex("\\{([^{}]+)}")) { it.groupValues[1] }
        .replace(Regex("[ \\t]+"), " ")
    return value.trim()
}

private fun formatExamTimer(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val hours = safe / 3600
    val minutes = (safe % 3600) / 60
    val secs = safe % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, secs) else "%02d:%02d".format(minutes, secs)
}

private fun formatMarks(value: Double): String = if (kotlin.math.abs(value - value.toInt()) < 0.00001) value.toInt().toString() else String.format(Locale.US, "%.2f", value)
private fun formatExamDate(ms: Long): String = runCatching { SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault()).format(Date(ms)) }.getOrDefault("")
