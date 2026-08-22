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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** Lightweight card retained for the legacy CPS surface. */
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
            }
            Text(if (joinable) "Join" else "Locked", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Lightweight card retained for the legacy CPS surface. */
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

/**
 * Keep the old navigation route compatible, but hand the exam to the hardened native activity.
 * This avoids resurrecting the retired WebView/remote-MathJax exam renderer.
 */
@Composable
fun NativeCpsExamScreen(nav: NavHostController, courseId: String, examId: String) {
    val context = LocalContext.current
    var opened by remember(courseId, examId) { mutableStateOf(false) }
    LaunchedEffect(courseId, examId) {
        if (!opened) {
            opened = true
            NativeCpsExamSafeActivity.open(context, courseId, examId)
            nav.popBackStack()
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(strokeWidth = 2.dp)
    }
}

/**
 * Result history deliberately uses only native Compose Text. Result metadata never needs a TeX
 * engine, WebView, JavaScript, remote MathJax, or regex normalization. Older server rows are also
 * keyed by index + normalized id so a malformed/duplicate id cannot crash LazyColumn composition.
 */
@Composable
fun NativeExamHistoryScreen(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsExamResultRepository(context) }
    var results by remember { mutableStateOf(runCatching { repository.cached() }.getOrDefault(emptyList())) }
    var loading by remember { mutableStateOf(results.isEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val refreshed = runCatching { repository.refresh() }
        refreshed.onSuccess {
            results = it
            error = null
        }.onFailure {
            error = it.message?.takeIf(String::isNotBlank) ?: "Exam results could not be refreshed"
        }
        loading = false
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "exam-history-header") {
            Spacer(Modifier.size(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                }
                Column(Modifier.weight(1f)) {
                    Text("Exam Results", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Your CPS exam history", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
        }

        error?.takeIf { results.isEmpty() }?.let { message ->
            item(key = "exam-history-error") {
                Text(message, color = MaterialTheme.colorScheme.error)
            }
        }

        if (!loading && results.isEmpty()) {
            item(key = "exam-history-empty") {
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                    Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.History, null, Modifier.size(34.dp))
                        Spacer(Modifier.size(8.dp))
                        Text("No exam result yet", fontWeight = FontWeight.Bold)
                        Text(
                            "Finish a CPS exam and the result will appear here.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        } else {
            itemsIndexed(
                items = results,
                key = { index, result -> "exam-result:${result.id.ifBlank { result.examId }}:$index" },
            ) { _, result ->
                val title = result.examTitle.trim().ifBlank { "CPS Exam" }.take(240)
                val course = result.courseTitle.trim().take(240)
                val maxScore = result.maxScore.takeIf { it.isFinite() && it > 0.0 }
                    ?: result.questionCount.toDouble().coerceAtLeast(0.0)
                val marks = result.marks.takeIf { it.isFinite() } ?: 0.0
                Card(
                    Modifier.fillMaxWidth(),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(title, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        if (course.isNotBlank()) Text(course, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "${formatResultNumber(marks)} / ${formatResultNumber(maxScore)}",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "Correct ${result.correct.coerceAtLeast(0)} • Wrong ${result.wrong.coerceAtLeast(0)} • Unanswered ${result.unanswered.coerceAtLeast(0)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (result.submittedAtMs > 0L) {
                            safeResultDate(result.submittedAtMs).takeIf { it.isNotBlank() }?.let { date ->
                                Text(date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
        item(key = "exam-history-footer") { Spacer(Modifier.size(16.dp)) }
    }
}

private fun formatResultNumber(value: Double): String {
    if (!value.isFinite()) return "0"
    return if (abs(value - value.toInt()) < 0.00001) value.toInt().toString()
    else String.format(Locale.US, "%.2f", value)
}

private fun safeResultDate(ms: Long): String = runCatching {
    SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault()).format(Date(ms))
}.getOrDefault("")
