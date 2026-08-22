package com.easyeducation.app

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Topic
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import coil.compose.AsyncImage
import java.util.Locale

private enum class Cps4Page { HOME, LIVE, PLAYLIST, ARCHIVES, RESOURCES, ROUTINE, TOPIC_CHAPTERS, TOPIC_CLASSES, TOPIC_LIST, CLASS, EXAMS }
private val Cps4Card = RoundedCornerShape(20.dp)
private val Cps4Small = RoundedCornerShape(14.dp)
private val Cps4Pill = RoundedCornerShape(999.dp)

@Composable
fun NativeCpsCourseExperienceV4(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val academicMap by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    var pageName by rememberSaveable(courseId) { mutableStateOf(Cps4Page.HOME.name) }
    var playlistId by rememberSaveable(courseId) { mutableStateOf("") }
    var playlistParent by rememberSaveable(courseId) { mutableStateOf(Cps4Page.LIVE.name) }
    var topicPlaylistId by rememberSaveable(courseId) { mutableStateOf("") }
    var topicClassId by rememberSaveable(courseId) { mutableStateOf("") }
    var selectedClassId by rememberSaveable(courseId) { mutableStateOf("") }
    var classReturnPage by rememberSaveable(courseId) { mutableStateOf(Cps4Page.PLAYLIST.name) }
    val page = runCatching { Cps4Page.valueOf(pageName) }.getOrDefault(Cps4Page.HOME)

    LaunchedEffect(courseId, state.online) {
        viewModel.loadCourse(courseId)
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, state.online, force = state.online)
    }

    BackHandler(enabled = page != Cps4Page.HOME && page != Cps4Page.CLASS) {
        pageName = when (page) {
            Cps4Page.PLAYLIST -> playlistParent
            Cps4Page.ARCHIVES -> Cps4Page.LIVE.name
            Cps4Page.TOPIC_CLASSES -> Cps4Page.TOPIC_CHAPTERS.name
            Cps4Page.TOPIC_LIST -> Cps4Page.TOPIC_CLASSES.name
            else -> Cps4Page.HOME.name
        }
    }

    val academic = academicMap[courseId]
    val accessActive = viewModel.hasCpsAccess(courseId) || academic?.hasAccess == true
    val enrichedState = remember(state, academic, accessActive) { cps4EnrichedState(state, courseId, academic, accessActive) }

    when (page) {
        Cps4Page.HOME -> Cps4Home(nav, viewModel, state, courseId, academic) { pageName = it.name }
        Cps4Page.LIVE -> Cps4Live(
            academic,
            onBack = { pageName = Cps4Page.HOME.name },
            onPlaylist = { id -> playlistId = id; playlistParent = Cps4Page.LIVE.name; pageName = Cps4Page.PLAYLIST.name },
            onArchives = { pageName = Cps4Page.ARCHIVES.name },
        )
        Cps4Page.ARCHIVES -> Cps4Archives(academic, { pageName = Cps4Page.LIVE.name }) { id ->
            playlistId = id
            playlistParent = Cps4Page.ARCHIVES.name
            pageName = Cps4Page.PLAYLIST.name
        }
        Cps4Page.PLAYLIST -> Cps4Playlist(
            bundle = academic,
            playlistId = playlistId,
            accessActive = accessActive,
            onBack = { pageName = playlistParent },
            onClass = { id -> selectedClassId = id; classReturnPage = Cps4Page.PLAYLIST.name; pageName = Cps4Page.CLASS.name },
        )
        Cps4Page.RESOURCES -> Cps4Resources(academic, accessActive) { pageName = Cps4Page.HOME.name }
        Cps4Page.ROUTINE -> Cps4Routine(courseId, state.online) { pageName = Cps4Page.HOME.name }
        Cps4Page.TOPIC_CHAPTERS -> Cps4TopicChapters(academic, { pageName = Cps4Page.HOME.name }) { id -> topicPlaylistId = id; pageName = Cps4Page.TOPIC_CLASSES.name }
        Cps4Page.TOPIC_CLASSES -> Cps4TopicClasses(academic, topicPlaylistId, { pageName = Cps4Page.TOPIC_CHAPTERS.name }) { id -> topicClassId = id; pageName = Cps4Page.TOPIC_LIST.name }
        Cps4Page.TOPIC_LIST -> Cps4TopicList(context, academic, topicClassId, accessActive, { pageName = Cps4Page.TOPIC_CLASSES.name }) { id ->
            selectedClassId = id
            classReturnPage = Cps4Page.TOPIC_LIST.name
            pageName = Cps4Page.CLASS.name
        }
        Cps4Page.CLASS -> Cps4WatchHost(
            viewModel = viewModel,
            state = enrichedState,
            courseId = courseId,
            initialClassId = selectedClassId,
            onExit = { pageName = classReturnPage },
        )
        Cps4Page.EXAMS -> Cps4Exams(state, courseId) { pageName = Cps4Page.HOME.name }
    }
}

private fun cps4EnrichedState(state: NativeUiState, courseId: String, bundle: NativeCpsAcademicBundle?, accessActive: Boolean): NativeUiState {
    if (bundle == null) return state
    val course = state.courseContent[courseId]?.course ?: state.cpsCourses.firstOrNull { it.course.id == courseId }?.course ?: return state
    val resourcesByClass = bundle.resources
        .filter { accessActive && !it.locked && it.url.isNotBlank() }
        .groupBy { it.classId }
    val classes = bundle.playlists.sortedBy { it.order }.flatMap { playlist ->
        playlist.classes.sortedBy { it.order }.map { item ->
            NativeClassItem(
                id = item.id,
                courseId = courseId,
                title = item.title,
                topic = item.description,
                subjects = listOf(playlist.title),
                chapters = listOf(playlist.title),
                order = playlist.order * 10_000 + item.order,
                duration = "",
                sourceUrl = if (accessActive) item.videoUrl else "",
                downloadUrl = if (accessActive) item.videoUrl else "",
                teacherName = "Easy Education",
                imageUrl = item.thumbnailUrl,
                resourceLinks = resourcesByClass[item.id].orEmpty().distinctBy { it.url }.map { NativeResourceLink(it.title, it.url) },
                isArchived = playlist.type.equals("ARCHIVE", true),
            )
        }
    }
    if (classes.isEmpty()) return state
    val subjects = bundle.playlists.sortedBy { it.order }.mapIndexed { index, playlist ->
        NativeSubject("cps-playlist:${playlist.id}", courseId, playlist.title, index)
    }
    val content = NativeCourseContent(course, subjects, emptyList(), classes)
    return state.copy(courseContent = state.courseContent + (courseId to content))
}

@Composable
private fun Cps4Home(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState, courseId: String, bundle: NativeCpsAcademicBundle?, onPage: (Cps4Page) -> Unit) {
    val course = state.courseContent[courseId]?.course ?: state.cpsCourses.firstOrNull { it.course.id == courseId }?.course
    val access = viewModel.hasCpsAccess(courseId) || bundle?.hasAccess == true
    if (course == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back({ nav.popBackStack() }, course.title) }
        item {
            Card(shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) AsyncImage(course.thumbnailUrl, course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (access) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp)); Text(if (access) "Access active" else "Preview mode", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        item { Cps4Tile("Live Classes", "Chapter-wise live class library", Icons.Default.LiveTv) { onPage(Cps4Page.LIVE) } }
        item { Cps4Tile("Exams", "Timed exams and saved results", Icons.Default.Quiz) { onPage(Cps4Page.EXAMS) } }
        item { Cps4Tile("Slides & Practice Sheet", "Notes and resources from CPS classes", Icons.Default.Description) { onPage(Cps4Page.RESOURCES) } }
        item { Cps4Tile("Routine", "Course routine", Icons.Default.CalendarMonth) { onPage(Cps4Page.ROUTINE) } }
        item { Cps4Tile("All Topics", "Chapter → class → timestamp topics", Icons.Default.Topic) { onPage(Cps4Page.TOPIC_CHAPTERS) } }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun Cps4Live(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onPlaylist: (String) -> Unit, onArchives: () -> Unit) {
    val playlists = bundle?.playlists.orEmpty().filter { it.type.equals("LIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "Live Classes") }
        if (playlists.isEmpty()) item { Cps4Message("No live-class chapter is available yet.") }
        items(playlists, key = { "live-${it.id}" }) { p -> Cps4PlaylistCard(p.title, p.classes.size, false) { onPlaylist(p.id) } }
        if (archives.isNotEmpty()) item {
            Card(Modifier.fillMaxWidth().clickable(onClick = onArchives), shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Folder, null, Modifier.size(24.dp)); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text("Archives", fontWeight = FontWeight.ExtraBold); Text("${archives.size} archive sections • ${archives.sumOf { it.classes.size }} classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps4Archives(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onPlaylist: (String) -> Unit) {
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "Archives") }
        if (archives.isEmpty()) item { Cps4Message("No archive is available yet.") }
        items(archives, key = { "archive-${it.id}" }) { p -> Cps4PlaylistCard(p.title, p.classes.size, true) { onPlaylist(p.id) } }
    }
}

@Composable
private fun Cps4PlaylistCard(title: String, count: Int, archive: Boolean, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (archive) Icons.Default.Folder else Icons.Default.LiveTv, null, Modifier.size(23.dp)); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text("$count classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun Cps4Playlist(bundle: NativeCpsAcademicBundle?, playlistId: String, accessActive: Boolean, onBack: () -> Unit, onClass: (String) -> Unit) {
    val context = LocalContext.current
    val playlist = bundle?.playlists.orEmpty().firstOrNull { it.id == playlistId }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, playlist?.title ?: "Classes") }
        if (playlist == null || playlist.classes.isEmpty()) item { Cps4Message("No class is available in this chapter yet.") }
        playlist?.let { group ->
            items(group.classes.sortedBy { it.order }, key = { "class-${group.id}-${it.id}" }) { item ->
                val hasSource = item.videoUrl.isNotBlank()
                Card(Modifier.fillMaxWidth().clickable(enabled = accessActive && hasSource) {
                    if (hasSource) onClass(item.id) else Toast.makeText(context, "Refreshing class source…", Toast.LENGTH_SHORT).show()
                }, shape = Cps4Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (!accessActive) Icons.Default.Lock else Icons.Default.PlayArrow, null, Modifier.size(22.dp)); Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) { Text(item.title, fontWeight = FontWeight.Bold); if (item.timestamps.isNotBlank()) Text("Topics available", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (accessActive) Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps4Resources(bundle: NativeCpsAcademicBundle?, accessActive: Boolean, onBack: () -> Unit) {
    val context = LocalContext.current
    val grouped = bundle?.resources.orEmpty().groupBy { it.chapter.ifBlank { "Resources" } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "Slides & Practice Sheet") }
        if (grouped.isEmpty()) item { Cps4Message("No slides or practice resources are available yet.") }
        grouped.forEach { (chapter, resources) ->
            item(key = "resource-title-$chapter") { Cps4Section(chapter) }
            items(resources, key = { it.id }) { r ->
                val open = accessActive && r.url.isNotBlank()
                Card(Modifier.fillMaxWidth().clickable(enabled = open) { NativeResourceViewerActivity.open(context, r.title, r.url) }, shape = Cps4Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Description, null); Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(r.title, fontWeight = FontWeight.SemiBold); Text(r.kind.ifBlank { "resource" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(if (open) Icons.Default.ArrowForward else Icons.Default.Lock, null) }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

private data class Cps4RoutineItem(val week: String, val date: String, val day: String, val time: String, val title: String, val raw: String)

@Composable
private fun Cps4Routine(courseId: String, online: Boolean, onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { NativeCpsRoutineRepository(context) }
    var sheet by remember(courseId) { mutableStateOf(repository.cached(courseId)) }
    var loading by remember(courseId) { mutableStateOf(sheet == null) }
    var error by remember(courseId) { mutableStateOf<String?>(null) }
    LaunchedEffect(courseId, online) {
        if (!online) { loading = false; return@LaunchedEffect }
        loading = sheet == null
        runCatching { repository.refresh(courseId) }.onSuccess { sheet = it; error = null }.onFailure { error = it.message }
        loading = false
    }
    val rows = remember(sheet) { cps4RoutineItems(sheet) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "Course Routine") }
        if (loading) item { Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() } }
        if (!loading && rows.isEmpty() && sheet?.text.isNullOrBlank()) item { Cps4Message(error ?: if (online) "No routine could be read from the course routine sheet." else "Connect once to load the course routine.") }
        var lastWeek = ""
        rows.forEachIndexed { index, row ->
            if (row.week.isNotBlank() && row.week != lastWeek) { lastWeek = row.week; item(key = "week-$index-${row.week}") { Cps4Section(row.week) } }
            item(key = "routine-$index-${row.date}-${row.title.hashCode()}") {
                Card(shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        if (row.date.isNotBlank() || row.day.isNotBlank()) Text(listOf(row.date, row.day).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                        if (row.time.isNotBlank()) Surface(shape = Cps4Pill, color = MaterialTheme.colorScheme.primaryContainer) { Text(row.time, Modifier.padding(horizontal = 10.dp, vertical = 6.dp), fontWeight = FontWeight.Bold) }
                        Text(row.title.ifBlank { row.raw }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        sheet?.text?.takeIf { it.isNotBlank() && rows.isEmpty() }?.let { text -> item { Cps4Message(text) } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

private fun cps4RoutineItems(sheet: NativeCpsRoutineSheet?): List<Cps4RoutineItem> {
    if (sheet == null) return emptyList()
    var currentWeek = ""
    val result = mutableListOf<Cps4RoutineItem>()
    val dateRegex = Regex("""(?i)\b(?:\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}/\d{2,4})\b""")
    val dayRegex = Regex("""(?i)^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$""")
    val weekRegex = Regex("""(?i)\bweek\s*[-–—:]?\s*\d+\b""")
    val timeRegex = Regex("""(?i)(?:Live\s*Class|Exam|Class)?\s*\(?\d{1,2}:\d{2}\s*(?:AM|PM)?\s*(?:-|–|—|to)\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\)?""")
    sheet.rows.forEach { rawRow ->
        val cells = rawRow.map { it.trim() }.filter { it.isNotBlank() }
        if (cells.isEmpty()) return@forEach
        val week = cells.firstNotNullOfOrNull { weekRegex.find(it)?.value }
        if (!week.isNullOrBlank()) currentWeek = week.replaceFirstChar { it.uppercase() }
        val lowered = cells.joinToString(" ").lowercase(Locale.getDefault())
        if ((lowered.contains("date") && lowered.contains("day") && (lowered.contains("topic") || lowered.contains("class"))) || (cells.size == 1 && week != null)) return@forEach
        val date = cells.firstNotNullOfOrNull { dateRegex.find(it)?.value }.orEmpty()
        val day = cells.firstOrNull { dayRegex.matches(it) }.orEmpty()
        val time = cells.firstOrNull { timeRegex.containsMatchIn(it) || it.contains("live class", true) }?.let { timeRegex.find(it)?.value ?: it }.orEmpty()
        val excluded = setOf(date, day, time, week.orEmpty()).filter { it.isNotBlank() }.map { it.lowercase(Locale.getDefault()) }.toSet()
        val content = cells.filter { cell ->
            val lower = cell.lowercase(Locale.getDefault())
            lower !in excluded && !weekRegex.matches(cell) && !dayRegex.matches(cell) && !dateRegex.matches(cell) && !timeRegex.matches(cell) && lower !in setOf("date", "day", "topic", "class", "schedule", "time", "week")
        }
        val title = content.maxByOrNull { it.length }.orEmpty()
        if (date.isNotBlank() || day.isNotBlank() || time.isNotBlank() || title.isNotBlank()) result += Cps4RoutineItem(currentWeek, date, day, time, title, cells.joinToString(" • "))
    }
    return result
}

@Composable
private fun Cps4TopicChapters(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onChapter: (String) -> Unit) {
    val topics = bundle?.topics.orEmpty()
    val chapters = bundle?.playlists.orEmpty().sortedBy { it.order }.filter { p -> topics.any { it.playlistId == p.id } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "All Topics") }
        if (chapters.isEmpty()) item { Cps4Message("No timestamped topics are available yet.") }
        items(chapters, key = { "topic-chapter-${it.id}" }) { p ->
            val classCount = topics.filter { it.playlistId == p.id }.map { it.classId }.distinct().size
            Card(Modifier.fillMaxWidth().clickable { onChapter(p.id) }, shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Topic, null); Spacer(Modifier.width(11.dp)); Column(Modifier.weight(1f)) { Text(p.title, fontWeight = FontWeight.ExtraBold); Text("$classCount classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) }
            }
        }
    }
}

@Composable
private fun Cps4TopicClasses(bundle: NativeCpsAcademicBundle?, playlistId: String, onBack: () -> Unit, onClass: (String) -> Unit) {
    val playlist = bundle?.playlists.orEmpty().firstOrNull { it.id == playlistId }
    val topics = bundle?.topics.orEmpty().filter { it.playlistId == playlistId }
    val groups = playlist?.classes.orEmpty().filter { c -> topics.any { it.classId == c.id } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, playlist?.title ?: "Classes") }
        if (groups.isEmpty()) item { Cps4Message("No timestamped class is available in this chapter.") }
        items(groups, key = { "topic-class-${it.id}" }) { c ->
            val count = topics.count { it.classId == c.id }
            Card(Modifier.fillMaxWidth().clickable { onClass(c.id) }, shape = Cps4Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(c.title, fontWeight = FontWeight.Bold); Text("$count topics", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) }
            }
        }
    }
}

@Composable
private fun Cps4TopicList(context: Context, bundle: NativeCpsAcademicBundle?, classId: String, accessActive: Boolean, onBack: () -> Unit, onClass: (String) -> Unit) {
    val cls = bundle?.playlists.orEmpty().flatMap { it.classes }.firstOrNull { it.id == classId }
    val topics = bundle?.topics.orEmpty().filter { it.classId == classId }.sortedBy { it.videoTimestamp }
    val sourceReady = cls?.videoUrl?.isNotBlank() == true
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, cls?.title ?: "Topics") }
        if (topics.isEmpty()) item { Cps4Message("No timestamped topic is available for this class.") }
        items(topics, key = { it.id }) { topic ->
            val open = accessActive && sourceReady
            Card(Modifier.fillMaxWidth().clickable(enabled = open) {
                NativePlayerTopics.seek(context, classId, topic.videoTimestamp)
                onClass(classId)
            }, shape = Cps4Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = Cps4Pill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(cps4Timestamp(topic.videoTimestamp), Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.width(10.dp)); Text(topic.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Icon(if (!accessActive) Icons.Default.Lock else Icons.Default.PlayArrow, null, Modifier.size(19.dp))
                }
            }
        }
        if (accessActive && !sourceReady) item { Cps4Message("Refreshing the class video source. Pull to refresh if it does not appear.") }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps4WatchHost(viewModel: NativeAppViewModel, state: NativeUiState, courseId: String, initialClassId: String, onExit: () -> Unit) {
    val watchNav = rememberNavController()
    var launched by remember(initialClassId) { mutableStateOf(false) }
    NavHost(watchNav, startDestination = "watch-root", modifier = Modifier.fillMaxSize()) {
        composable("watch-root") {
            LaunchedEffect(initialClassId) {
                if (!launched && initialClassId.isNotBlank()) {
                    launched = true
                    watchNav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(initialClassId)}")
                } else if (launched) onExit()
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        composable("class/{courseId}/{classId}", listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("classId") { type = NavType.StringType })) { entry ->
            val cid = Uri.decode(entry.arguments?.getString("courseId").orEmpty())
            val classId = Uri.decode(entry.arguments?.getString("classId").orEmpty())
            YoutubeClassWatchPage(watchNav, viewModel, state, cid, classId)
        }
    }
}

@Composable
private fun Cps4Exams(state: NativeUiState, courseId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val exams = state.cpsCourseExtras[courseId]?.exams.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps4Back(onBack, "Exams") }
        if (exams.isEmpty()) item { Cps4Message("No exam is available for this course yet.") }
        items(exams, key = { it.id }) { exam ->
            Card(Modifier.fillMaxWidth().clickable { NativeCpsExamSafeActivity.open(context, courseId, exam.id) }, shape = Cps4Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Quiz, null); Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(exam.title, fontWeight = FontWeight.Bold); Text(buildList { if (exam.duration > 0) add("${exam.duration} min"); if (exam.questionsCount > 0) add("${exam.questionsCount} questions"); if (exam.status.isNotBlank()) add(exam.status) }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) }
            }
        }
    }
}

@Composable private fun Cps4Tile(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = Cps4Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(12.dp).size(24.dp)) }; Spacer(Modifier.width(13.dp)); Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.ExtraBold); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) }
    }
}
@Composable private fun Cps4Back(onBack: () -> Unit, title: String) { Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
@Composable private fun Cps4Section(title: String) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold) }
@Composable private fun Cps4Message(text: String) { Card(shape = Cps4Small, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) { Text(text, Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) } }
private fun cps4Timestamp(seconds: Int): String { val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = (safe % 3600) / 60; val s = safe % 60; return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s) }
