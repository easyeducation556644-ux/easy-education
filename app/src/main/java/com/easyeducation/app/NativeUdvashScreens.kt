@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
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
import androidx.compose.runtime.mutableIntStateOf
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
    val refreshing: Boolean = true,
    val data: T? = null,
    val error: String = "",
)

@Composable
fun NativeUdvashHomeBlock(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var count by remember { mutableStateOf<Int?>(repository.cachedCatalog().size.takeIf { it > 0 }) }
    LaunchedEffect(Unit) {
        runCatching { withContext(Dispatchers.IO) { repository.catalog().size } }
            .onSuccess { count = it }
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
    var reload by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf(UdvashLoadState<List<NativeUdvashCourse>>()) }

    LaunchedEffect(reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedCatalog() }
        state = UdvashLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.catalog() } }
            .onSuccess { state = UdvashLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load Udvash courses") }
    }

    UdvashPageScaffold(nav, "Udvash") {
        when {
            state.data == null && state.refreshing -> item { UdvashLoading() }
            state.data == null && state.error.isNotBlank() -> item { UdvashError(state.error) { reload += 1 } }
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
                            AsyncImage(course.iconPath, null, Modifier.size(58.dp), contentScale = ContentScale.Fit)
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
        UdvashRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
    }
}

@Composable
fun NativeUdvashSubjectsScreen(nav: NavHostController, courseId: String) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(courseId) { mutableStateOf(UdvashLoadState<List<NativeUdvashSubject>>()) }
    LaunchedEffect(courseId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedSubjects(courseId) }
        state = UdvashLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.subjects(courseId) } }
            .onSuccess { state = UdvashLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load subjects") }
    }

    UdvashPageScaffold(nav, "Subjects") {
        when {
            state.data == null && state.refreshing -> item { UdvashLoading() }
            state.data == null && state.error.isNotBlank() -> item { UdvashError(state.error) { reload += 1 } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No subjects", "This Udvash course has no subject structure yet.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { subject ->
                UdvashRow(
                    title = subject.name,
                    subtitle = "${subject.chapterCount} chapters${if (subject.shortName.isNotBlank()) " • ${subject.shortName}" else ""}",
                    image = subject.iconPath,
                ) { nav.navigate("udvash/${Uri.encode(courseId)}/${subject.id}") }
            }
        }
        UdvashRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
    }
}

@Composable
fun NativeUdvashChaptersScreen(nav: NavHostController, courseId: String, subjectId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(courseId, subjectId) { mutableStateOf(UdvashLoadState<List<NativeUdvashChapter>>()) }
    LaunchedEffect(courseId, subjectId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedChapters(courseId, subjectId) }
        state = UdvashLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.chapters(courseId, subjectId) } }
            .onSuccess { state = UdvashLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load chapters") }
    }

    UdvashPageScaffold(nav, "Chapters") {
        when {
            state.data == null && state.refreshing -> item { UdvashLoading() }
            state.data == null && state.error.isNotBlank() -> item { UdvashError(state.error) { reload += 1 } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No chapters", "No chapters are available for this subject.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { chapter ->
                val title = chapter.displayNameBn.ifBlank { chapter.name.ifBlank { chapter.displayNameEn.ifBlank { "Chapter" } } }
                UdvashRow(title, chapter.displayNameEn.takeIf { it.isNotBlank() && it != title }.orEmpty()) {
                    nav.navigate("udvash/${Uri.encode(courseId)}/$subjectId/${chapter.id}")
                }
            }
        }
        UdvashRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
    }
}

@Composable
fun NativeUdvashContentTypesScreen(nav: NavHostController, courseId: String, subjectId: Int, chapterId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(courseId, subjectId, chapterId) { mutableStateOf(UdvashLoadState<List<NativeUdvashContentType>>()) }
    LaunchedEffect(courseId, subjectId, chapterId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedContentTypes(courseId, subjectId, chapterId) }
        state = UdvashLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.contentTypes(courseId, subjectId, chapterId) } }
            .onSuccess { state = UdvashLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load class types") }
    }

    UdvashPageScaffold(nav, "Class types") {
        when {
            state.data == null && state.refreshing -> item { UdvashLoading() }
            state.data == null && state.error.isNotBlank() -> item { UdvashError(state.error) { reload += 1 } }
            state.data.orEmpty().isEmpty() -> item { UdvashEmpty("No content", "No class type is available in this chapter right now.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { type ->
                UdvashRow(type.title, "${type.totalContentCount} classes") {
                    nav.navigate("udvash/${Uri.encode(courseId)}/$subjectId/$chapterId/${type.id}")
                }
            }
        }
        UdvashRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
    }
}

@Composable
fun NativeUdvashCardsScreen(nav: NavHostController, courseId: String, subjectId: Int, chapterId: Int, contentTypeId: Int) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(courseId, subjectId, chapterId, contentTypeId) { mutableStateOf(UdvashLoadState<List<NativeUdvashCard>>()) }
    LaunchedEffect(courseId, subjectId, chapterId, contentTypeId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedCards(courseId, subjectId, chapterId, contentTypeId) }
        state = UdvashLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.cards(courseId, subjectId, chapterId, contentTypeId) } }
            .onSuccess { state = UdvashLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load classes") }
    }

    UdvashPageScaffold(nav, "Classes") {
        when {
            state.data == null && state.refreshing -> item { UdvashLoading() }
            state.data == null && state.error.isNotBlank() -> item { UdvashError(state.error) { reload += 1 } }
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
        UdvashRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
    }
}

@Composable
fun NativeUdvashClassScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    appState: NativeUiState,
    courseId: String,
    subjectId: Int,
    chapterId: Int,
    contentTypeId: Int,
    contentId: Int,
) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(courseId, subjectId, chapterId, contentTypeId, contentId) {
        mutableStateOf(UdvashLoadState<NativeUdvashClassDetail>())
    }

    LaunchedEffect(courseId, subjectId, chapterId, contentTypeId, contentId, reload) {
        val cached = withContext(Dispatchers.IO) {
            repository.cachedClassDetail(courseId, subjectId, chapterId, contentTypeId, contentId)
        }
        state = UdvashLoadState(refreshing = true, data = cached)
        runCatching {
            withContext(Dispatchers.IO) { repository.classDetail(courseId, subjectId, chapterId, contentTypeId, contentId) }
        }.onSuccess {
            state = UdvashLoadState(refreshing = false, data = it)
        }.onFailure { error ->
            state = state.copy(refreshing = false, error = error.message ?: "Could not load class")
        }
    }

    val detail = state.data
    if (detail == null) {
        if (state.refreshing) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else {
            UdvashStandaloneError(nav, state.error.ifBlank { "Could not load class" }) { reload += 1 }
        }
        return
    }

    val syntheticCourseId = "udvash:$courseId"
    val syntheticClassId = "udvash:$courseId:$subjectId:$chapterId:$contentTypeId:$contentId"
    val sourceUrl = NativeUdvashRepository.virtualClassSource(courseId, subjectId, chapterId, contentTypeId, contentId)
    val subjectName = detail.subjectName.ifBlank { "Udvash" }
    val chapterName = detail.chapterName.ifBlank { "Classes" }
    val resources = detail.notes.map { NativeResourceLink(it.label, it.url) }
    val content = NativeCourseContent(
        course = NativeCourse(
            id = syntheticCourseId,
            title = detail.courseName.ifBlank { "Udvash" },
            description = detail.description,
            thumbnailUrl = "",
            price = 0.0,
            courseFormat = "udvash",
        ),
        subjects = listOf(NativeSubject("udvash-subject-$subjectId", syntheticCourseId, subjectName, 0)),
        chapters = listOf(NativeChapter("udvash-chapter-$chapterId", syntheticCourseId, subjectName, chapterName, 0)),
        classes = listOf(
            NativeClassItem(
                id = syntheticClassId,
                courseId = syntheticCourseId,
                title = detail.title,
                topic = detail.description,
                subjects = listOf(subjectName),
                chapters = listOf(chapterName),
                order = 0,
                duration = "",
                sourceUrl = sourceUrl,
                downloadUrl = detail.youtubeUrl,
                teacherName = "Udvash",
                resourceLinks = resources,
            ),
        ),
    )
    val enrichedState = appState.copy(courseContent = appState.courseContent + (syntheticCourseId to content))

    Box(Modifier.fillMaxSize()) {
        YoutubeClassWatchPage(nav, viewModel, enrichedState, syntheticCourseId, syntheticClassId)
        if (state.refreshing) {
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp),
                shape = RoundedCornerShape(999.dp),
                tonalElevation = 5.dp,
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Checking class updates…", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@Composable
private fun UdvashPageScaffold(
    nav: NavHostController,
    title: String,
    subtitle: String = "Cache first • fresh data in background",
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        content()
        item { Spacer(Modifier.height(18.dp)) }
    }
}

private fun LazyListScope.UdvashRefreshFooter(
    refreshing: Boolean,
    hasData: Boolean,
    error: String,
    onRetry: () -> Unit,
) {
    if (refreshing && hasData) {
        item {
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(9.dp))
                Text("Checking for updates…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    } else if (error.isNotBlank() && hasData) {
        item {
            TextButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
                Spacer(Modifier.width(7.dp))
                Text("Refresh failed • Tap to retry")
            }
        }
    }
}

@Composable
private fun UdvashRow(title: String, subtitle: String = "", image: String = "", onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (image.isNotBlank()) {
                AsyncImage(image, null, Modifier.size(48.dp), contentScale = ContentScale.Fit)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold)
                if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun UdvashLoading() {
    Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun UdvashError(message: String, retry: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick = retry) {
                Icon(Icons.Default.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(7.dp)); Text("Retry")
            }
        }
    }
}

@Composable
private fun UdvashEmpty(title: String, subtitle: String) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun UdvashStandaloneError(nav: NavHostController, message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Udvash class", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        UdvashError(message, retry)
    }
}
