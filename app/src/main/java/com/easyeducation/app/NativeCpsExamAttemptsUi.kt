package com.easyeducation.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.EmojiEvents
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
    var leaderboard by rememberSaveable(courseId, exam.id) { mutableStateOf(false) }
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

    BackHandler {
        if (leaderboard) leaderboard = false else onBack()
    }

    if (leaderboard) {
        CpsExamLeaderboard(
            exam = exam,
            overview = overview,
            loading = loading,
            error = error,
            onBack = { leaderboard = false },
        )
        return
    }

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
                            "Your first submitted attempt will be the only attempt used for this exam's leaderboard.",
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
                    OutlinedButton(
                        onClick = { leaderboard = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = CpsAttemptPill,
                    ) {
                        Icon(Icons.Default.EmojiEvents, null, Modifier.size(18.dp))
                        Spacer(Modifier.size(7.dp))
                        Text("Leaderboard")
                    }
                    Text(
                        "Retakes taken: ${overview.retakeCount} • Retake scores never change leaderboard rank.",
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("First Attempt", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "${cpsAttemptNumber(first.marks)} / ${cpsAttemptNumber(first.maxScore)}",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                Surface(shape = CpsAttemptPill, color = MaterialTheme.colorScheme.surface) {
                    Text(
                        "Leaderboard score",
                        Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (first) "Attempt 1" else "Retake $index",
                    Modifier.weight(1f),
                    fontWeight = FontWeight.ExtraBold,
                )
                if (first) {
                    Surface(shape = CpsAttemptPill, color = MaterialTheme.colorScheme.primaryContainer) {
                        Text(
                            "Leaderboard",
                            Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
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
private fun CpsExamLeaderboard(
    exam: NativeCpsExamSummary,
    overview: NativeCpsExamOverview,
    loading: Boolean,
    error: String?,
    onBack: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            CpsAttemptBack(onBack, "Leaderboard")
        }
        item {
            Card(
                shape = CpsAttemptCard,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(exam.title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                    Text("First attempt only", fontWeight = FontWeight.Bold)
                    Text(
                        "Every student appears once. Retake results are excluded from ranking.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
        }

        if (loading && overview.leaderboard.isEmpty()) {
            item {
                Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
        } else if (overview.leaderboard.isEmpty()) {
            item {
                Card(
                    shape = CpsAttemptSmall,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Text(
                        error ?: "Leaderboard is not available yet.",
                        Modifier.fillMaxWidth().padding(16.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            itemsIndexed(
                overview.leaderboard,
                key = { _, row -> "rank-${row.rank}-${row.userName}-${row.submittedAtMs}" },
            ) { _, row ->
                CpsLeaderboardRowCard(row)
            }
        }

        error?.takeIf { it.isNotBlank() && overview.leaderboard.isNotEmpty() }?.let { message ->
            item {
                Text(
                    "Showing the last saved leaderboard. $message",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun CpsLeaderboardRowCard(row: NativeCpsLeaderboardRow) {
    val podium = row.rank <= 3
    Card(
        shape = if (podium) CpsAttemptCard else CpsAttemptSmall,
        border = BorderStroke(
            if (row.isYou) 2.dp else 1.dp,
            if (row.isYou) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
        colors = CardDefaults.cardColors(
            containerColor = if (row.isYou) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = if (podium) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
                    Text("#${row.rank}", fontWeight = FontWeight.ExtraBold)
                }
            }
            Spacer(Modifier.size(11.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        row.userName,
                        Modifier.weight(1f),
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (row.isYou) {
                        Text("You", fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
                    }
                }
                Text(
                    "${row.correct} correct • ${cpsAttemptDuration(row.timeTakenSeconds)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(cpsAttemptNumber(row.marks), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                if (row.maxScore > 0.0) {
                    Text("/ ${cpsAttemptNumber(row.maxScore)}", style = MaterialTheme.typography.labelSmall)
                }
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
