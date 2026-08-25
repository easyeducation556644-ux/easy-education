package com.easyeducation.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val CpsAttemptCard = RoundedCornerShape(20.dp)
private val CpsAttemptSmall = RoundedCornerShape(14.dp)
private val CpsAttemptPill = RoundedCornerShape(999.dp)

@Composable
fun NativeCpsExamAttemptsScreen(
    courseId: String,
    exam: NativeCpsExamSummary,
    online: Boolean,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val repository = remember(context) { NativeCpsExamResultRepository(context) }
    var overview by remember(courseId, exam.id) {
        mutableStateOf(repository.cachedExamOverview(courseId, exam.id))
    }
    var loading by remember(courseId, exam.id) { mutableStateOf(false) }
    var error by remember(courseId, exam.id) { mutableStateOf<String?>(null) }
    var resumeTick by remember(courseId, exam.id) { mutableIntStateOf(0) }

    DisposableEffect(lifecycleOwner, courseId, exam.id) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) resumeTick += 1
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(courseId, exam.id, online, resumeTick) {
        if (!online) {
            loading = false
            return@LaunchedEffect
        }
        loading = true
        runCatching {
            repository.examOverview(
                courseId = courseId,
                examId = exam.id,
                examTitle = exam.title,
                maxScore = exam.maxScore,
                questionCount = exam.questionsCount,
            )
        }.onSuccess {
            overview = it
            error = null
        }.onFailure {
            error = it.message
        }
        loading = false
    }

    BackHandler(onBack = onBack)

    val first = overview.firstAttempt
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            CpsAttemptBack(onBack, exam.title)
        }

        item {
            Card(
                shape = CpsAttemptCard,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                            Icon(Icons.Default.Quiz, null, Modifier.padding(11.dp).size(24.dp))
                        }
                        Spacer(Modifier.size(11.dp))
                        Column(Modifier.weight(1f)) {
                            Text(exam.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                            val meta = buildList {
                                if (exam.duration > 0) add("${exam.duration} min")
                                if (exam.questionsCount > 0) add("${exam.questionsCount} questions")
                                if (exam.maxScore > 0) add("${cpsAttemptNumber(exam.maxScore)} marks")
                            }.joinToString(" • ")
                            if (meta.isNotBlank()) {
                                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (exam.description.isNotBlank()) {
                        Text(exam.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        if (first == null) {
            item {
                Card(
                    shape = CpsAttemptCard,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("No attempt yet", fontWeight = FontWeight.ExtraBold)
                        Text(
                            "Take the exam to see your result and attempt history here.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(
                            onClick = { NativeCpsExamSafeActivity.open(context, courseId, exam.id) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = CpsAttemptPill,
                        ) {
                            Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                            Spacer(Modifier.size(7.dp))
                            Text("Start Exam")
                        }
                    }
                }
            }
        } else {
            item {
                CpsFirstAttemptCard(first, overview.retakeCount)
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Button(
                        onClick = { NativeCpsExamSafeActivity.open(context, courseId, exam.id) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = CpsAttemptPill,
                    ) {
                        Icon(Icons.Default.History, null, Modifier.size(18.dp))
                        Spacer(Modifier.size(7.dp))
                        Text("Retake Exam")
                    }
                    Text(
                        "Retakes taken: ${overview.retakeCount}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item {
                Text("Exam Attempts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
            }
            itemsIndexed(
                overview.attempts,
                key = { index, attempt -> "attempt-$index-${attempt.id}" },
            ) { index, attempt ->
                CpsAttemptResultCard(attempt, index)
            }
        }

        if (loading) {
            item {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                }
            }
        }
        error?.takeIf { it.isNotBlank() }?.let { message ->
            item {
                Text(
                    if (overview.attempts.isNotEmpty()) "Showing saved attempts. $message" else message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun CpsFirstAttemptCard(first: NativeCpsExamResult, retakeCount: Int) {
    Card(
        shape = CpsAttemptCard,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("First Attempt", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text(
                "${cpsAttemptNumber(first.marks)} / ${cpsAttemptNumber(first.maxScore)}",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "${first.correct} correct • ${first.wrong} wrong • ${first.unanswered} unanswered",
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Time ${cpsAttemptDuration(first.timeTakenSeconds)} • Retakes $retakeCount",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun CpsAttemptResultCard(attempt: NativeCpsExamResult, index: Int) {
    val first = index == 0
    Card(
        shape = CpsAttemptSmall,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (first) "Attempt 1" else "Retake $index",
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "${cpsAttemptNumber(attempt.marks)} / ${cpsAttemptNumber(attempt.maxScore)}",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "${attempt.correct} correct • ${attempt.wrong} wrong • ${attempt.unanswered} unanswered • ${cpsAttemptDuration(attempt.timeTakenSeconds)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (attempt.submittedAtMs > 0L) {
                Text(
                    cpsAttemptDate(attempt.submittedAtMs),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun CpsAttemptBack(onBack: () -> Unit, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(
            title,
            Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun cpsAttemptDuration(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val h = safe / 3600
    val m = (safe % 3600) / 60
    val s = safe % 60
    return if (h > 0) "%d:%02d:%02d".format(Locale.US, h, m, s)
    else "%02d:%02d".format(Locale.US, m, s)
}

private fun cpsAttemptDate(value: Long): String =
    runCatching {
        SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault()).format(Date(value))
    }.getOrDefault("")

private fun cpsAttemptNumber(value: Double): String {
    if (!value.isFinite()) return "0"
    val whole = value.toLong()
    return if (value == whole.toDouble()) whole.toString()
    else String.format(Locale.US, "%.2f", value).trimEnd('0').trimEnd('.')
}
