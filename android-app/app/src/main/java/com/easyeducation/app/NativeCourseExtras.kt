package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

private const val ARCHIVE_SUBJECT_SENTINEL = "__archive__"

private data class NativeArchiveGroup(
    val key: String,
    val subject: String,
    val chapter: String,
    val count: Int,
)

@Composable
fun NativeArchiveEntryCard(onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Icon(Icons.Default.Archive, null, Modifier.padding(12.dp).size(25.dp))
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text("Archive", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "View archived chapters and classes",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("›", style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
fun NativeArchiveCourseScreen(
    nav: NavHostController,
    state: NativeUiState,
    courseId: String,
) {
    val content = state.courseContent[courseId]
    if (content == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val archived = content.classes.filter { it.isArchived }
    val groups = remember(archived) { archiveGroups(archived) }
    val title = content.course?.title ?: state.courses.firstOrNull { it.id == courseId }?.title ?: "Archive"

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                }
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("Archive", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (groups.isEmpty()) {
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Text("No archived classes are available.", Modifier.padding(18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            items(groups, key = { it.key }) { group ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            nav.navigate(
                                "archive-chapter/$courseId/${Uri.encode(group.subject)}/${Uri.encode(group.chapter)}",
                            )
                        },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(11.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                            Icon(Icons.Default.Archive, null, Modifier.padding(10.dp).size(23.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(group.chapter, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val meta = listOf(
                                group.subject.takeIf { it.isNotBlank() && it != ARCHIVE_SUBJECT_SENTINEL },
                                "${group.count} class${if (group.count == 1) "" else "es"}",
                            ).filterNotNull().joinToString(" • ")
                            Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text("›", style = MaterialTheme.typography.headlineSmall)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeArchiveChapterScreen(
    nav: NavHostController,
    state: NativeUiState,
    courseId: String,
    subject: String,
    chapter: String,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val content = state.courseContent[courseId]
    if (content == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val classes = content.classes.filter { item ->
        if (!item.isArchived) return@filter false
        val nonArchiveChapters = item.chapters.filterNot { it.equals("archive", true) }
        val actualChapter = nonArchiveChapters.firstOrNull().orEmpty().ifBlank { "Archived classes" }
        val nonArchiveSubjects = item.subjects.filterNot { it.equals("archive", true) }
        val actualSubject = nonArchiveSubjects.firstOrNull().orEmpty().ifBlank { ARCHIVE_SUBJECT_SENTINEL }
        actualChapter.equals(chapter, true) && actualSubject.equals(subject, true)
    }.sortedWith(compareBy<NativeClassItem> { it.order }.thenBy { it.title.lowercase() })

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(chapter, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("Archive", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (classes.isEmpty()) {
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) { Text("No archived classes in this chapter.", Modifier.padding(18.dp)) }
            }
        } else {
            items(classes, key = { it.id }) { item ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            NativeWatchBackdrop.capture(context)
                            nav.navigate("class/$courseId/${item.id}")
                        },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    shape = RoundedCornerShape(13.dp),
                ) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (item.imageUrl.isNotBlank()) {
                            AsyncImage(
                                model = item.imageUrl,
                                contentDescription = item.title,
                                modifier = Modifier.width(102.dp).height(66.dp),
                            )
                        } else {
                            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                Icon(Icons.Default.PlayArrow, null, Modifier.padding(18.dp).size(28.dp))
                            }
                        }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (item.teacherName.isNotBlank()) {
                                Text(item.teacherName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeTelegramJoinCard(
    course: NativeCourse,
    online: Boolean,
) {
    if (course.telegramLink.isBlank()) return
    val context = androidx.compose.ui.platform.LocalContext.current
    val user = FirebaseAuth.getInstance().currentUser ?: return
    val firestore = remember { FirebaseFirestore.getInstance() }
    var status by remember(course.id, user.uid) { mutableStateOf("loading") }
    var dialogStep by remember(course.id, user.uid) { mutableIntStateOf(0) }
    var telegramId by remember(course.id, user.uid) { mutableStateOf("") }
    var mobile by remember(course.id, user.uid) { mutableStateOf("") }
    var submitting by remember(course.id, user.uid) { mutableStateOf(false) }
    var errorText by remember(course.id, user.uid) { mutableStateOf<String?>(null) }

    LaunchedEffect(course.id, user.uid, online) {
        if (!online) {
            status = "offline"
            return@LaunchedEffect
        }
        status = "loading"
        status = runCatching {
            withContext(Dispatchers.IO) {
                val snapshot = firestore.collection("telegramSubmissions")
                    .whereEqualTo("userId", user.uid)
                    .get(Source.SERVER)
                    .await()
                val matching = snapshot.documents
                    .mapNotNull { it.data }
                    .filter { it["courseId"]?.toString() == course.id }
                when {
                    matching.any { it["status"]?.toString()?.equals("joined", true) == true } -> "joined"
                    matching.isNotEmpty() -> "requested"
                    else -> "none"
                }
            }
        }.getOrElse { "none" }
    }

    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) {
                    Icon(Icons.Default.Send, null, Modifier.padding(10.dp).size(23.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text("টেলিগ্রাম গ্রুপে যুক্ত হন", fontWeight = FontWeight.Bold)
                    Text(
                        when (status) {
                            "joined" -> "You are already marked as joined."
                            "requested" -> "Request sent. Open the group and complete joining."
                            "offline" -> "Connect to submit or check your join request."
                            else -> "Submit your Telegram details, then open the course group."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.76f),
                    )
                }
                if (status == "joined") Icon(Icons.Default.CheckCircle, "Joined", tint = MaterialTheme.colorScheme.primary)
            }
            Button(
                onClick = {
                    if (status == "joined" || status == "requested") openTelegram(context, course.telegramLink)
                    else dialogStep = 1
                },
                enabled = online && status != "loading",
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(999.dp),
            ) {
                if (status == "loading") {
                    CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(7.dp))
                }
                Text(if (status == "joined" || status == "requested") "Open Telegram group" else "Join Telegram")
            }
        }
    }

    if (dialogStep > 0) {
        AlertDialog(
            onDismissRequest = { if (!submitting) dialogStep = 0 },
            title = { Text(if (dialogStep == 1) "Telegram ID" else "Mobile number") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        if (dialogStep == 1) "Enter your Telegram username or ID."
                        else "Enter the mobile number connected to your Telegram account.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = if (dialogStep == 1) telegramId else mobile,
                        onValueChange = { value -> if (dialogStep == 1) telegramId = value else mobile = value },
                        singleLine = true,
                        label = { Text(if (dialogStep == 1) "Telegram ID" else "Mobile number") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    errorText?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !submitting,
                    onClick = {
                        errorText = null
                        if (dialogStep == 1) {
                            if (telegramId.trim().isBlank()) {
                                errorText = "Telegram ID is required."
                            } else {
                                dialogStep = 2
                            }
                        } else {
                            if (mobile.trim().isBlank()) {
                                errorText = "Mobile number is required."
                            } else {
                                submitting = true
                                kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                                    runCatching {
                                        firestore.collection("telegramSubmissions").add(
                                            mapOf(
                                                "userId" to user.uid,
                                                "userName" to (user.displayName ?: ""),
                                                "userEmail" to (user.email ?: ""),
                                                "telegramId" to telegramId.trim(),
                                                "telegramMobile" to mobile.trim(),
                                                "courseId" to course.id,
                                                "courseName" to course.title,
                                                "status" to "requested",
                                                "submittedAt" to FieldValue.serverTimestamp(),
                                            ),
                                        ).await()
                                    }.onSuccess {
                                        status = "requested"
                                        dialogStep = 0
                                        submitting = false
                                        openTelegram(context, course.telegramLink)
                                    }.onFailure { error ->
                                        submitting = false
                                        errorText = error.message ?: "Could not submit the Telegram request."
                                    }
                                }
                            }
                        }
                    },
                ) {
                    if (submitting) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text(if (dialogStep == 1) "Next" else "Submit & open Telegram")
                }
            },
            dismissButton = {
                Row {
                    if (dialogStep == 2) TextButton(enabled = !submitting, onClick = { dialogStep = 1 }) { Text("Back") }
                    TextButton(enabled = !submitting, onClick = { dialogStep = 0 }) { Text("Cancel") }
                }
            },
        )
    }
}

private fun archiveGroups(classes: List<NativeClassItem>): List<NativeArchiveGroup> {
    val groups = linkedMapOf<String, MutableList<NativeClassItem>>()
    for (item in classes) {
        val subject = item.subjects.firstOrNull { !it.equals("archive", true) }
            ?.takeIf { it.isNotBlank() }
            ?: ARCHIVE_SUBJECT_SENTINEL
        val chapters = item.chapters.filter { it.isNotBlank() && !it.equals("archive", true) }
            .ifEmpty { listOf("Archived classes") }
        for (chapter in chapters) {
            groups.getOrPut("${subject.lowercase()}\u0000${chapter.lowercase()}") { mutableListOf() }.add(item)
        }
    }
    return groups.entries.map { (_, items) ->
        val first = items.first()
        val subject = first.subjects.firstOrNull { !it.equals("archive", true) }
            ?.takeIf { it.isNotBlank() }
            ?: ARCHIVE_SUBJECT_SENTINEL
        val chapter = first.chapters.firstOrNull { it.isNotBlank() && !it.equals("archive", true) }
            ?: "Archived classes"
        NativeArchiveGroup(
            key = "${subject.lowercase()}\u0000${chapter.lowercase()}",
            subject = subject,
            chapter = chapter,
            count = items.distinctBy { it.id }.size,
        )
    }.sortedWith(compareBy<NativeArchiveGroup> { it.chapter.lowercase() }.thenBy { it.subject.lowercase() })
}

private fun openTelegram(context: Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
