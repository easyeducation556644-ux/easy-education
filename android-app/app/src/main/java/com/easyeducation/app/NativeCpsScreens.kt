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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.LiveTv
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
import androidx.compose.runtime.mutableStateMapOf
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

@Composable
fun NativeCpsLiveClassCard(item: NativeCpsLiveClass) {
    val context = LocalContext.current
    val joinable = item.hasAccess && (item.url.startsWith("http://") || item.url.startsWith("https://"))
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = joinable) {
            NativeResourceViewerActivity.open(context, item.title, item.url)
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Icon(
                    Icons.Default.LiveTv,
                    null,
                    Modifier.padding(10.dp).size(24.dp),
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                )
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
                Icon(
                    Icons.Default.Event,
                    null,
                    Modifier.padding(10.dp).size(24.dp),
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                )
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
    var payload by remember(courseId, examId) { mutableStateOf<NativeCpsExamPayload?>(null) }
    var loading by remember(courseId, examId) { mutableStateOf(true) }
    var error by remember(courseId, examId) { mutableStateOf<String?>(null) }
    var submitted by remember(courseId, examId) { mutableStateOf(false) }
    val answers = remember(courseId, examId) { mutableStateMapOf<String, Int>() }

    LaunchedEffect(courseId, examId) {
        loading = true
        error = null
        runCatching { repository.loadExam(courseId, examId) }
            .onSuccess { payload = it }
            .onFailure { error = it.message ?: "Exam questions could not be loaded" }
        loading = false
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        error != null -> {
            Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                    Text("Exam", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Card(border = BorderStroke(1.dp, MaterialTheme.colorScheme.error), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(error.orEmpty(), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
        }
        payload == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Exam is unavailable") }
        else -> {
            val examPayload = payload!!
            val questions = examPayload.questions
            val correct = questions.count { question ->
                val selected = answers[question.id]
                selected != null && question.correctIndex >= 0 && selected == question.correctIndex
            }
            val wrong = questions.count { question ->
                val selected = answers[question.id]
                selected != null && question.correctIndex >= 0 && selected != question.correctIndex
            }
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                        Column(Modifier.weight(1f)) {
                            Text(examPayload.exam.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Local-only practice • answers are never submitted to CPS", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (questions.isEmpty()) {
                    item {
                        Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                            Text("No readable questions are available for this exam.", Modifier.padding(18.dp))
                        }
                    }
                } else {
                    itemsIndexed(questions, key = { _, item -> item.id }) { index, question ->
                        Card(
                            Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("${index + 1}. ${question.question}", fontWeight = FontWeight.SemiBold)
                                question.options.forEachIndexed { optionIndex, option ->
                                    Row(
                                        Modifier.fillMaxWidth().clickable(enabled = !submitted) {
                                            answers[question.id] = optionIndex
                                        }.padding(vertical = 3.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(
                                            selected = answers[question.id] == optionIndex,
                                            onClick = { if (!submitted) answers[question.id] = optionIndex },
                                            enabled = !submitted,
                                        )
                                        Spacer(Modifier.width(8.dp))
                                        Text(option, Modifier.weight(1f))
                                    }
                                }
                                if (submitted && question.correctIndex >= 0) {
                                    HorizontalDivider()
                                    val selected = answers[question.id]
                                    Text(
                                        if (selected == question.correctIndex) "Correct" else "Correct answer: ${question.options.getOrNull(question.correctIndex).orEmpty()}",
                                        color = if (selected == question.correctIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    if (question.explanation.isNotBlank()) Text(question.explanation, style = MaterialTheme.typography.bodySmall)
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
                            ) { Text("Finish locally") }
                        } else {
                            Card(
                                Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                                shape = RoundedCornerShape(16.dp),
                            ) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.CheckCircle, null)
                                        Spacer(Modifier.width(8.dp))
                                        Text("Practice result", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                    }
                                    Text("Correct: $correct • Wrong: $wrong • Answered: ${answers.size}/${questions.size}")
                                    Text("This result stays only on this screen. No CPS submission document is created.", style = MaterialTheme.typography.bodySmall)
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
