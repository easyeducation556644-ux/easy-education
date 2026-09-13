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
import androidx.compose.runtime.saveable.rememberSaveable
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

private data class ExternalLoadState<T>(
    val refreshing: Boolean = true,
    val data: T? = null,
    val error: String = "",
)

@Composable
fun NativeExternalPlatformsHomeBlock(nav: NavHostController) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.10f)) {
                    Icon(Icons.Default.School, null, Modifier.padding(10.dp).size(24.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("More learning platforms", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                    Text("Live course catalogs", style = MaterialTheme.typography.bodySmall)
                }
            }
            NativeExternalCoursesRepository.providers.forEach { provider ->
                Surface(
                    modifier = Modifier.fillMaxWidth().clickable { nav.navigate("provider/${provider.id}") },
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.70f),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(provider.name, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Icon(Icons.Default.ArrowForward, "Open ${provider.name}")
                    }
                }
            }
        }
    }
}

@Composable
fun NativeExternalCatalogScreen(nav: NavHostController, providerId: String) {
    val context = LocalContext.current
    val repository = remember { NativeExternalCoursesRepository(context) }
    val title = NativeExternalCoursesRepository.providerTitle(providerId)
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(providerId) { mutableStateOf(ExternalLoadState<List<NativeExternalCourse>>()) }

    LaunchedEffect(providerId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedCatalog(providerId) }
        state = ExternalLoadState(refreshing = true, data = cached.takeIf { it.isNotEmpty() })
        runCatching { withContext(Dispatchers.IO) { repository.catalog(providerId) } }
            .onSuccess { state = ExternalLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load $title") }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { ExternalHeader(nav = nav, title = title, subtitle = "Live course catalog") }
        when {
            state.data == null && state.refreshing -> item { ExternalLoading() }
            state.data == null && state.error.isNotBlank() -> item { ExternalError(state.error) { reload += 1 } }
            state.data.orEmpty().isEmpty() -> item { ExternalMessage("No courses are available right now.") }
            else -> items(state.data.orEmpty(), key = { it.id }) { course ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable {
                        nav.navigate("provider/${providerId}/${Uri.encode(course.id)}")
                    },
                    shape = RoundedCornerShape(19.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (course.thumbnailUrl.isNotBlank()) {
                            AsyncImage(
                                model = course.thumbnailUrl,
                                contentDescription = null,
                                modifier = Modifier.size(72.dp),
                                contentScale = ContentScale.Crop,
                            )
                            Spacer(Modifier.width(12.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(course.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (course.batch.isNotBlank()) Text(course.batch, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (course.description.isNotBlank()) Text(course.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        ExternalRefreshFooter(state.refreshing, state.data != null, state.error) { reload += 1 }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
fun NativeExternalCourseScreen(nav: NavHostController, providerId: String, courseId: String) {
    val context = LocalContext.current
    val repository = remember { NativeExternalCoursesRepository(context) }
    val providerName = NativeExternalCoursesRepository.providerTitle(providerId)
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(providerId, courseId) { mutableStateOf(ExternalLoadState<NativeExternalCourseDetail>()) }
    var selectedSectionId by rememberSaveable(providerId, courseId) { mutableStateOf<String?>(null) }
    var selectedLectureId by rememberSaveable(providerId, courseId) { mutableStateOf<String?>(null) }

    LaunchedEffect(providerId, courseId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedCourse(providerId, courseId) }
        state = ExternalLoadState(refreshing = true, data = cached)
        runCatching { withContext(Dispatchers.IO) { repository.course(providerId, courseId) } }
            .onSuccess { detail ->
                state = ExternalLoadState(refreshing = false, data = detail)
                if (selectedSectionId != null && detail.sections.none { it.id == selectedSectionId }) {
                    selectedSectionId = null
                    selectedLectureId = null
                }
            }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not load course") }
    }

    val detail = state.data
    val selectedSection = detail?.sections?.firstOrNull { it.id == selectedSectionId }
    val selectedLecture = selectedSection?.lectures?.firstOrNull { it.id == selectedLectureId }

    BackHandler(enabled = selectedSectionId != null) {
        if (selectedLectureId != null) selectedLectureId = null
        else selectedSectionId = null
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            when {
                selectedLecture != null -> ExternalHeader(
                    nav = nav,
                    title = selectedLecture.title,
                    subtitle = selectedSection?.title.orEmpty(),
                    onBack = { selectedLectureId = null },
                )
                selectedSection != null -> ExternalHeader(
                    nav = nav,
                    title = selectedSection.title,
                    subtitle = detail?.course?.title ?: providerName,
                    onBack = { selectedSectionId = null },
                )
                else -> ExternalHeader(nav = nav, title = detail?.course?.title ?: providerName, subtitle = providerName)
            }
        }

        when {
            detail == null && state.refreshing -> item { ExternalLoading() }
            detail == null && state.error.isNotBlank() -> item { ExternalError(state.error) { reload += 1 } }
            detail == null -> item { ExternalMessage("Course is unavailable.") }
            selectedLecture != null -> {
                if (selectedLecture.description.isNotBlank()) item {
                    Text(selectedLecture.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item {
                    Text("Content", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Classes, videos and resources inside this lecture", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (selectedLecture.items.isEmpty()) item { ExternalMessage("No content is available inside this lecture.") }
                else items(selectedLecture.items, key = { it.id }) { contentItem ->
                    ExternalContentCard(
                        item = contentItem,
                        onPlay = {
                            nav.navigate("provider-class/$providerId/${Uri.encode(courseId)}/${Uri.encode(contentItem.id)}")
                        },
                        onOpenResource = { url ->
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        },
                    )
                }
            }
            selectedSection != null -> {
                if (selectedSection.description.isNotBlank()) item {
                    Text(selectedSection.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item {
                    Text("Lectures / Chapters", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Open a card to see its classes and resources", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (selectedSection.lectures.isEmpty()) item { ExternalMessage("No lectures are available in this section.") }
                else items(selectedSection.lectures, key = { it.id }) { lecture ->
                    val playableCount = lecture.items.count { it.playable }
                    ExternalHierarchyCard(
                        title = lecture.title,
                        description = lecture.description,
                        meta = "${lecture.items.size} items • $playableCount playable",
                        onClick = { selectedLectureId = lecture.id },
                    )
                }
            }
            else -> {
                if (detail.course.thumbnailUrl.isNotBlank()) item {
                    AsyncImage(
                        model = detail.course.thumbnailUrl,
                        contentDescription = detail.course.title,
                        modifier = Modifier.fillMaxWidth().height(180.dp),
                        contentScale = ContentScale.Crop,
                    )
                }
                if (detail.course.description.isNotBlank()) item {
                    Text(detail.course.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item {
                    Text("Course content", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Sections first — classes are kept inside their lecture/chapter cards", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (detail.sections.isEmpty()) item { ExternalMessage("No structured sections are available for this course.") }
                else items(detail.sections, key = { it.id }) { section ->
                    val itemCount = section.lectures.sumOf { it.items.size }
                    ExternalHierarchyCard(
                        title = section.title,
                        description = section.description,
                        meta = "${section.lectures.size} lectures • $itemCount items",
                        onClick = {
                            selectedSectionId = section.id
                            selectedLectureId = null
                        },
                    )
                }
            }
        }
        ExternalRefreshFooter(state.refreshing, detail != null, state.error) { reload += 1 }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun ExternalHierarchyCard(
    title: String,
    description: String,
    meta: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(Icons.Default.School, null, Modifier.padding(9.dp).size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (description.isNotBlank()) Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun ExternalContentCard(
    item: NativeExternalContentItem,
    onPlay: () -> Unit,
    onOpenResource: (String) -> Unit,
) {
    val resourceUrl = item.resourceLinks.firstOrNull()?.url.orEmpty().ifBlank { item.sourceUrl }
    val canOpen = item.playable && item.sourceUrl.isNotBlank() || resourceUrl.isNotBlank()
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = canOpen) {
            if (item.playable && item.sourceUrl.isNotBlank()) onPlay() else if (resourceUrl.isNotBlank()) onOpenResource(resourceUrl)
        },
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(13.dp), color = if (item.playable) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.secondaryContainer) {
                Icon(
                    if (item.playable) Icons.Default.PlayArrow else Icons.Default.Description,
                    null,
                    Modifier.padding(9.dp).size(22.dp),
                    tint = if (item.playable) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val typeLabel = listOf(item.type, item.linkType).filter { it.isNotBlank() }.distinct().joinToString(" • ")
                if (typeLabel.isNotBlank()) Text(typeLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.topic.isNotBlank()) Text(item.topic, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (item.playable && item.resourceLinks.isNotEmpty()) Text("${item.resourceLinks.size} attached resources", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (canOpen) Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
fun NativeExternalClassScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    appState: NativeUiState,
    providerId: String,
    courseId: String,
    classId: String,
) {
    val context = LocalContext.current
    val repository = remember { NativeExternalCoursesRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var state by remember(providerId, courseId, classId) { mutableStateOf(ExternalLoadState<NativeExternalCourseDetail>()) }

    LaunchedEffect(providerId, courseId, classId, reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedCourse(providerId, courseId) }
        state = ExternalLoadState(refreshing = true, data = cached)
        runCatching { withContext(Dispatchers.IO) { repository.course(providerId, courseId) } }
            .onSuccess { state = ExternalLoadState(refreshing = false, data = it) }
            .onFailure { error -> state = state.copy(refreshing = false, error = error.message ?: "Could not refresh class") }
    }

    val detail = state.data
    val selected = detail?.classes?.firstOrNull { it.id == classId }
    if (detail == null || selected == null) {
        if (state.refreshing) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ExternalHeader(nav, "Class", NativeExternalCoursesRepository.providerTitle(providerId))
            ExternalError(state.error.ifBlank { "This class is unavailable." }) { reload += 1 }
        }
        return
    }

    val syntheticCourseId = "external:$providerId:$courseId"
    val syntheticClassId = "external:$providerId:$courseId:${selected.id}"
    val subjectName = selected.sectionTitle.ifBlank { detail.provider.name }
    val chapterName = selected.chapterTitle.ifBlank { subjectName }
    val content = NativeCourseContent(
        course = NativeCourse(
            id = syntheticCourseId,
            title = detail.course.title,
            description = detail.course.description,
            thumbnailUrl = detail.course.thumbnailUrl,
            price = 0.0,
            courseFormat = "external",
        ),
        subjects = listOf(NativeSubject("external-subject", syntheticCourseId, subjectName, 0)),
        chapters = listOf(NativeChapter("external-chapter", syntheticCourseId, subjectName, chapterName, 0)),
        classes = listOf(
            NativeClassItem(
                id = syntheticClassId,
                courseId = syntheticCourseId,
                title = selected.title,
                topic = selected.topic,
                subjects = listOf(subjectName),
                chapters = listOf(chapterName),
                order = selected.order,
                duration = "",
                sourceUrl = selected.sourceUrl,
                downloadUrl = selected.sourceUrl,
                teacherName = selected.teacherName,
                imageUrl = selected.imageUrl,
                resourceLinks = selected.resourceLinks,
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
private fun ExternalHeader(
    nav: NavHostController,
    title: String,
    subtitle: String,
    onBack: (() -> Unit)? = null,
) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onBack?.invoke() ?: nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ExternalLoading() {
    Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun ExternalMessage(message: String) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(message, Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ExternalError(message: String, retry: () -> Unit) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick = retry) {
                Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
                Spacer(Modifier.width(7.dp))
                Text("Retry")
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.ExternalRefreshFooter(
    refreshing: Boolean,
    hasData: Boolean,
    error: String,
    retry: () -> Unit,
) {
    if (refreshing && hasData) item {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
            Text("Checking for updates…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else if (error.isNotBlank() && hasData) item {
        TextButton(onClick = retry, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
            Spacer(Modifier.width(7.dp))
            Text("Live refresh failed • Retry")
        }
    }
}
