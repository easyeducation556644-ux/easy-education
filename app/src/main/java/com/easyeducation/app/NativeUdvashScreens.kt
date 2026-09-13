@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class UdvashLoadState<T>(
    val loading: Boolean = true,
    val data: T? = null,
    val error: String = "",
)

@Composable
fun NativeUdvashHomeBlock(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var count by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) {
        count = runCatching { withContext(Dispatchers.IO) { repository.catalog().size } }.getOrNull()
    }
    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("udvash") },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = RoundedCornerShape(24.dp),
    ) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.10f)) {
                Icon(Icons.Default.School, null, Modifier.padding(12.dp).size(28.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Udvash", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    when (count) {
                        null -> "Premium course library"
                        0 -> "No Udvash course access yet"
                        else -> "$count accessible course${if (count == 1) "" else "s"}"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.75f),
                )
            }
            Icon(Icons.Default.ArrowForward, "Open Udvash")
        }
    }
}

@Composable
fun NativeUdvashCatalogScreen(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember { mutableStateOf(UdvashLoadState<List<NativeUdvashCourse>>()) }

    fun load() {
        state = UdvashLoadState()
    }

    LaunchedEffect(state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching { withContext(Dispatchers.IO) { repository.catalog() } }
            .fold(
                onSuccess = { UdvashLoadState(loading = false, data = it) },
                onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load Udvash courses") },
            )
    }

    UdvashPageScaffold(nav, "Udvash") {
        when {
            state.loading -> item { UdvashLoading() }
            state.error.isNotBlank() -> item { UdvashError(state.error) { load() } }
            state.data.orEmpty().isEmpty() -> item {
                UdvashEmpty("No Udvash course access", "Your Easy Education account does not have an active Udvash entitlement yet.")
            }
            else -> items(state.data.orEmpty(), key = { it.id }) { course ->
                Card(
                    Modifier.fillMaxWidth().clickable { nav.navigate("udvash/${Uri.encode(course.id)}") },
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (course.iconPath.isNotBlank()) {
                            AsyncImage(
                                model = course.iconPath,
                                contentDescription = null,
                                modifier = Modifier.size(58.dp),
                                contentScale = ContentScale.Fit,
                            )
                            Spacer(Modifier.width(12.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(course.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("Premium access", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
    }
}

@Composable
fun NativeUdvashSubjectsScreen(nav: NavHostController, courseId: String) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember(courseId) { mutableStateOf(UdvashLoadState<List<NativeUdvashSubject>>()) }
    LaunchedEffect(courseId, state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching { withContext(Dispatchers.IO) { repository.subjects(courseId) } }
            .fold(
                onSuccess = { UdvashLoadState(loading = false, data = it) },
                onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load subjects") },
            )
    }

    UdvashPageScaffold(nav, "Subjects") {
        when {
            state.loading -> item { UdvashLoading() }
            state.error.isNotBlank() -> item { UdvashError(state.error) { state = UdvashLoadState() } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No subjects", "This Udvash course has no cached subject structure yet.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { subject ->
                UdvashRow(
                    title = subject.name,
                    subtitle = "${subject.chapterCount} chapters${if (subject.shortName.isNotBlank()) " • ${subject.shortName}" else ""}",
                    image = subject.iconPath,
                ) { nav.navigate("udvash/${Uri.encode(courseId)}/${subject.id}") }
            }
        }
    }
}

@Composable
fun NativeUdvashChaptersScreen(nav: NavHostController, courseId: String, subjectId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember(courseId, subjectId) { mutableStateOf(UdvashLoadState<List<NativeUdvashChapter>>()) }
    LaunchedEffect(courseId, subjectId, state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching { withContext(Dispatchers.IO) { repository.chapters(courseId, subjectId) } }
            .fold(
                onSuccess = { UdvashLoadState(loading = false, data = it) },
                onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load chapters") },
            )
    }

    UdvashPageScaffold(nav, "Chapters") {
        when {
            state.loading -> item { UdvashLoading() }
            state.error.isNotBlank() -> item { UdvashError(state.error) { state = UdvashLoadState() } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No chapters", "No chapters are available for this subject.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { chapter ->
                val title = chapter.displayNameBn.ifBlank { chapter.name.ifBlank { chapter.displayNameEn.ifBlank { "Chapter" } } }
                UdvashRow(title, chapter.displayNameEn.takeIf { it.isNotBlank() && it != title }.orEmpty()) {
                    nav.navigate("udvash/${Uri.encode(courseId)}/$subjectId/${chapter.id}")
                }
            }
        }
    }
}

@Composable
fun NativeUdvashContentTypesScreen(nav: NavHostController, courseId: String, subjectId: Int, chapterId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember(courseId, subjectId, chapterId) { mutableStateOf(UdvashLoadState<List<NativeUdvashContentType>>()) }
    LaunchedEffect(courseId, subjectId, chapterId, state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching { withContext(Dispatchers.IO) { repository.contentTypes(courseId, subjectId, chapterId) } }
            .fold(
                onSuccess = { UdvashLoadState(loading = false, data = it) },
                onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load class types") },
            )
    }

    UdvashPageScaffold(nav, "Class types", subtitle = "Live from Udvash") {
        when {
            state.loading -> item { UdvashLoading() }
            state.error.isNotBlank() -> item { UdvashError(state.error) { state = UdvashLoadState() } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No content", "No class type is available in this chapter right now.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { type ->
                UdvashRow(type.title, "${type.totalContentCount} classes") {
                    nav.navigate("udvash/${Uri.encode(courseId)}/$subjectId/$chapterId/${type.id}")
                }
            }
        }
    }
}

@Composable
fun NativeUdvashCardsScreen(nav: NavHostController, courseId: String, subjectId: Int, chapterId: Int, contentTypeId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember(courseId, subjectId, chapterId, contentTypeId) { mutableStateOf(UdvashLoadState<List<NativeUdvashCard>>()) }
    LaunchedEffect(courseId, subjectId, chapterId, contentTypeId, state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching { withContext(Dispatchers.IO) { repository.cards(courseId, subjectId, chapterId, contentTypeId) } }
            .fold(
                onSuccess = { UdvashLoadState(loading = false, data = it) },
                onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load classes") },
            )
    }

    UdvashPageScaffold(nav, "Classes", subtitle = "Live from Udvash") {
        when {
            state.loading -> item { UdvashLoading() }
            state.error.isNotBlank() -> item { UdvashError(state.error) { state = UdvashLoadState() } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No classes", "No class is available in this group right now.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { card ->
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = !card.isBlocked) {
                        nav.navigate("udvash-class/${Uri.encode(courseId)}/$subjectId/$chapterId/$contentTypeId/${card.id}")
                    },
                    shape = RoundedCornerShape(18.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                            Icon(if (card.isBlocked) Icons.Default.Lock else Icons.Default.PlayArrow, null, Modifier.padding(10.dp).size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(card.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val meta = buildList {
                                if (card.hasVideo) add("Video")
                                if (card.hasNotes) add("Notes")
                                if (card.hasQuiz) add("Quiz")
                                if (card.isBlocked) add("Blocked")
                            }.joinToString(" • ")
                            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
    }
}

@Composable
fun NativeUdvashClassScreen(
    nav: NavHostController,
    courseId: String,
    subjectId: Int,
    chapterId: Int,
    contentTypeId: Int,
    contentId: Int,
    online: Boolean,
) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var state by remember(courseId, contentId) { mutableStateOf(UdvashLoadState<NativeUdvashClassDetail>()) }
    LaunchedEffect(courseId, contentId, state.loading) {
        if (!state.loading || state.data != null) return@LaunchedEffect
        state = runCatching {
            withContext(Dispatchers.IO) { repository.classDetail(courseId, subjectId, chapterId, contentTypeId, contentId) }
        }.fold(
            onSuccess = { UdvashLoadState(loading = false, data = it) },
            onFailure = { UdvashLoadState(loading = false, error = it.message ?: "Could not load class") },
        )
    }

    when {
        state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        state.error.isNotBlank() -> UdvashStandaloneError(nav, state.error) { state = UdvashLoadState() }
        state.data != null -> {
            val detail = state.data!!
            val sourceUrl = detail.videoOptions.firstOrNull()?.url.orEmpty().ifBlank { detail.youtubeUrl }
            BackHandler { nav.popBackStack() }
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    if (sourceUrl.isNotBlank()) {
                        NativeInlinePlayer(
                            classId = "udvash:${detail.masterContentId}",
                            sourceUrl = sourceUrl,
                            online = online,
                            requestedHeight = 720,
                            title = detail.title,
                            hasPrevious = false,
                            hasNext = false,
                            onPrevious = {},
                            onNext = {},
                            onSharedSessionClassChanged = {},
                            onBack = { nav.popBackStack() },
                            onMinimize = { nav.popBackStack() },
                            onExpandFromMini = {},
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Surface(Modifier.fillMaxWidth().aspectRatio(16f / 9f), color = MaterialTheme.colorScheme.surfaceVariant) {
                            Box(contentAlignment = Alignment.Center) { Text("Video source is not available") }
                        }
                    }
                }
                item {
                    Column(Modifier.padding(16.dp)) {
                        Text(detail.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(5.dp))
                        Text(
                            listOf(detail.subjectName, detail.chapterName).filter { it.isNotBlank() }.joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        val cleanDescription = detail.description.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim()
                        if (cleanDescription.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                            Text(cleanDescription, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (detail.videoOptions.isNotEmpty()) {
                    item {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                            Text("Available quality", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(detail.videoOptions.joinToString(" • ") { option -> if (option.resolution > 0) "${option.resolution}p" else "Video" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (detail.notes.isNotEmpty()) {
                    item { Text("Class resources", modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(detail.notes, key = { "${it.id}:${it.url}" }) { note ->
                        Card(
                            Modifier.padding(horizontal = 16.dp, vertical = 5.dp).fillMaxWidth().clickable {
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(note.url))) }
                            },
                            shape = RoundedCornerShape(16.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Description, null)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(note.label, fontWeight = FontWeight.Bold)
                                    if (note.fileSizeKB > 0) Text("${"%.1f".format(note.fileSizeKB / 1024.0)} MB", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Icon(Icons.Default.ArrowForward, null)
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun UdvashPageScaffold(
    nav: NavHostController,
    title: String,
    subtitle: String = "",
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Column {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
private fun UdvashRow(title: String, subtitle: String, image: String = "", onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (image.isNotBlank()) {
                AsyncImage(model = image, contentDescription = null, modifier = Modifier.size(48.dp), contentScale = ContentScale.Fit)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun UdvashLoading() {
    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun UdvashError(message: String, retry: () -> Unit) {
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.padding(18.dp)) {
            Text("Could not load Udvash", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
            Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick = retry) { Icon(Icons.Default.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Try again") }
        }
    }
}

@Composable
private fun UdvashEmpty(title: String, subtitle: String) {
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(20.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun UdvashStandaloneError(nav: NavHostController, message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Udvash Class", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) { UdvashError(message, retry) }
    }
}
