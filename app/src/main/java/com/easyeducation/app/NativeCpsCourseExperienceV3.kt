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
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Topic
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
import coil.compose.AsyncImage
import java.util.Locale

private enum class Cps3Page { HOME, LIVE, PLAYLIST, ARCHIVES, RESOURCES, ROUTINE, TOPICS, EXAMS }
private val Cps3Card = RoundedCornerShape(20.dp)
private val Cps3Small = RoundedCornerShape(14.dp)
private val Cps3Pill = RoundedCornerShape(999.dp)

@Composable
fun NativeCpsCourseExperienceV3(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val academicMap by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    var pageName by rememberSaveable(courseId) { mutableStateOf(Cps3Page.HOME.name) }
    var playlistId by rememberSaveable(courseId) { mutableStateOf("") }
    var playlistParent by rememberSaveable(courseId) { mutableStateOf(Cps3Page.LIVE.name) }
    val page = runCatching { Cps3Page.valueOf(pageName) }.getOrDefault(Cps3Page.HOME)

    LaunchedEffect(courseId, state.online) {
        viewModel.loadCourse(courseId)
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, state.online)
    }

    BackHandler(enabled = page != Cps3Page.HOME) {
        pageName = when (page) {
            Cps3Page.PLAYLIST -> playlistParent
            Cps3Page.ARCHIVES -> Cps3Page.LIVE.name
            else -> Cps3Page.HOME.name
        }
    }

    val academic = academicMap[courseId]
    when (page) {
        Cps3Page.HOME -> Cps3Home(nav, viewModel, state, courseId, academic) { pageName = it.name }
        Cps3Page.LIVE -> Cps3LiveHub(
            bundle = academic,
            onBack = { pageName = Cps3Page.HOME.name },
            onPlaylist = { selected -> playlistId = selected; playlistParent = Cps3Page.LIVE.name; pageName = Cps3Page.PLAYLIST.name },
            onArchives = { pageName = Cps3Page.ARCHIVES.name },
        )
        Cps3Page.PLAYLIST -> Cps3Playlist(nav, state, courseId, academic, playlistId) { pageName = playlistParent }
        Cps3Page.ARCHIVES -> Cps3Archives(academic, onBack = { pageName = Cps3Page.LIVE.name }) { selected ->
            playlistId = selected
            playlistParent = Cps3Page.ARCHIVES.name
            pageName = Cps3Page.PLAYLIST.name
        }
        Cps3Page.RESOURCES -> Cps3Resources(academic) { pageName = Cps3Page.HOME.name }
        Cps3Page.ROUTINE -> Cps3Routine(courseId, state.online) { pageName = Cps3Page.HOME.name }
        Cps3Page.TOPICS -> Cps3Topics(nav, state, courseId, academic) { pageName = Cps3Page.HOME.name }
        Cps3Page.EXAMS -> Cps3Exams(nav, state, courseId) { pageName = Cps3Page.HOME.name }
    }
}

@Composable
private fun Cps3Home(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    academic: NativeCpsAcademicBundle?,
    onPage: (Cps3Page) -> Unit,
) {
    val entry = state.cpsCourses.firstOrNull { it.course.id == courseId }
    val course = state.courseContent[courseId]?.course ?: entry?.course
    val access = academic?.hasAccess ?: viewModel.hasCpsAccess(courseId)
    if (course == null) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Cps3Back(nav, "CPS Course")
            repeat(5) { Box(Modifier.fillMaxWidth().height(72.dp).background(MaterialTheme.colorScheme.surfaceVariant, Cps3Small)) }
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(nav, course.title) }
        item {
            Card(shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) AsyncImage(course.thumbnailUrl, course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Cps3Chip("CPS"); Cps3Chip("LIVE + INSTANT") }
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (access) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(18.dp), tint = if (access) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(6.dp)); Text(if (access) "Access active" else "Preview mode", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        item { Cps3Tile("Live Classes", "Chapters, classes, current live and recordings", Icons.Default.LiveTv) { onPage(Cps3Page.LIVE) } }
        item { Cps3Tile("Exams", "Timed exams, answers and saved results", Icons.Default.Quiz) { onPage(Cps3Page.EXAMS) } }
        item { Cps3Tile("Slides & Practice Sheet", "Chapter-wise notes and practice resources", Icons.Default.Description) { onPage(Cps3Page.RESOURCES) } }
        item { Cps3Tile("Routine", "Course timeline from the official routine sheet", Icons.Default.CalendarMonth) { onPage(Cps3Page.ROUTINE) } }
        item { Cps3Tile("All Topics", "Chapter → class → exact video topics", Icons.Default.Topic) { onPage(Cps3Page.TOPICS) } }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun Cps3LiveHub(
    bundle: NativeCpsAcademicBundle?,
    onBack: () -> Unit,
    onPlaylist: (String) -> Unit,
    onArchives: () -> Unit,
) {
    val livePlaylists = bundle?.playlists.orEmpty().filter { it.type.equals("LIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "Live Classes") }
        if (livePlaylists.isEmpty()) item { Cps3Message("No live-class chapter is available yet.") }
        items(livePlaylists, key = { "cps3-live-${it.id}" }) { playlist ->
            val linked = bundle?.liveClasses.orEmpty().filter { cps3LiveBelongsTo(it, playlist) }
            Cps3PlaylistCard(
                title = playlist.title,
                count = playlist.classes.size,
                live = linked.any { it.cps3Running() },
                archive = false,
            ) { onPlaylist(playlist.id) }
        }
        if (archives.isNotEmpty()) {
            item {
                Card(Modifier.fillMaxWidth().clickable(onClick = onArchives), shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.tertiaryContainer) { Icon(Icons.Default.Folder, null, Modifier.padding(11.dp).size(23.dp)) }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) { Text("Archives", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text("${archives.size} archive${if (archives.size == 1) "" else "s"} • ${archives.sumOf { it.classes.size }} classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps3PlaylistCard(title: String, count: Int, live: Boolean, archive: Boolean, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(14.dp), color = when { live -> MaterialTheme.colorScheme.errorContainer; archive -> MaterialTheme.colorScheme.tertiaryContainer; else -> MaterialTheme.colorScheme.secondaryContainer }) {
                Icon(if (archive) Icons.Default.Folder else Icons.Default.LiveTv, null, Modifier.padding(11.dp).size(23.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (live) Cps3Status("LIVE")
                }
                Text("$count class${if (count == 1) "" else "es"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun Cps3Playlist(
    nav: NavHostController,
    state: NativeUiState,
    courseId: String,
    bundle: NativeCpsAcademicBundle?,
    playlistId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val playlist = bundle?.playlists.orEmpty().firstOrNull { it.id == playlistId }
    val contentClasses = state.courseContent[courseId]?.classes.orEmpty().associateBy { it.id }
    val linkedLives = if (playlist == null) emptyList() else bundle?.liveClasses.orEmpty().filter { cps3LiveBelongsTo(it, playlist) }
    val unmatchedLives = linkedLives.filter { live -> playlist?.classes.orEmpty().none { cps3LiveMatchesClass(live, it) } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, playlist?.title ?: "Classes") }
        if (playlist == null || (playlist.classes.isEmpty() && unmatchedLives.isEmpty())) item { Cps3Message("No class is available in this chapter yet.") }
        if (unmatchedLives.isNotEmpty()) {
            items(unmatchedLives, key = { "cps3-schedule-${it.id}" }) { live ->
                Cps3ScheduledLiveRow(live)
            }
        }
        playlist?.let { group ->
            items(group.classes, key = { "cps3-class-${group.id}-${it.id}" }) { classItem ->
                val content = contentClasses[classItem.id]
                val source = content?.sourceUrl.orEmpty().ifBlank { classItem.videoUrl }
                val playable = classItem.hasAccess && source.isNotBlank() && content != null
                val live = linkedLives.firstOrNull { cps3LiveMatchesClass(it, classItem) }
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = playable) {
                        nav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(classItem.id)}")
                    },
                    shape = Cps3Small,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = if (live?.cps3Running() == true) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
                            Icon(if (playable) Icons.Default.PlayArrow else Icons.Default.Lock, null, Modifier.padding(10.dp).size(21.dp))
                        }
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Text(classItem.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val meta = buildList {
                                live?.status?.takeIf { it.isNotBlank() }?.uppercase(Locale.getDefault())?.let(::add)
                                if (live?.recordings?.isNotEmpty() == true) add("Recording available")
                                if (classItem.timestamps.isNotBlank()) add("Topics available")
                            }.joinToString(" • ")
                            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps3ScheduledLiveRow(live: NativeCpsAcademicLive) {
    val context = LocalContext.current
    Card(shape = Cps3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LiveTv, null, Modifier.size(21.dp)); Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) { Text(live.title, fontWeight = FontWeight.Bold); if (live.startTime.isNotBlank()) Text(live.startTime, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (live.status.isNotBlank()) Cps3Status(live.status.uppercase(Locale.getDefault()))
            }
            when {
                live.cps3Running() && live.hasAccess && live.url.isNotBlank() -> Button(onClick = { NativeCpsLivePlayerActivity.openLive(context, live.title, live.url, live.id) }, modifier = Modifier.fillMaxWidth(), shape = Cps3Pill) { Text("Watch live") }
                live.cps3Upcoming() -> OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth(), shape = Cps3Pill) { Icon(Icons.Default.Schedule, null); Spacer(Modifier.width(6.dp)); Text("Upcoming") }
                live.cps3Ended() && live.recordings.isNotEmpty() -> {
                    val recording = live.recordings.firstOrNull { it.url.isNotBlank() }
                    if (recording != null) Button(onClick = { NativeCpsLivePlayerActivity.openRecording(context, recording.title.ifBlank { live.title }, recording.url, "${live.id}:${recording.id}") }, modifier = Modifier.fillMaxWidth(), shape = Cps3Pill) { Text("Play recording") }
                }
            }
        }
    }
}

@Composable
private fun Cps3Archives(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onPlaylist: (String) -> Unit) {
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "Archives") }
        if (archives.isEmpty()) item { Cps3Message("No archive is available yet.") }
        items(archives, key = { "cps3-archive-${it.id}" }) { playlist -> Cps3PlaylistCard(playlist.title, playlist.classes.size, live = false, archive = true) { onPlaylist(playlist.id) } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps3Resources(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val context = LocalContext.current
    val grouped = bundle?.resources.orEmpty().groupBy { it.chapter.ifBlank { "Resources" } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "Slides & Practice Sheet") }
        if (grouped.isEmpty()) item { Cps3Message("No slides or practice resources are available yet.") }
        grouped.forEach { (chapter, resources) ->
            item(key = "cps3-resource-title-$chapter") { Cps3Section(chapter) }
            items(resources, key = { it.id }) { resource ->
                Card(Modifier.fillMaxWidth().clickable(enabled = !resource.locked && resource.url.isNotBlank()) { NativeResourceViewerActivity.open(context, resource.title, resource.url) }, shape = Cps3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Description, null, Modifier.size(22.dp)); Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) { Text(resource.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text(resource.kind.replace('-', ' ').ifBlank { "resource" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Icon(if (resource.locked || resource.url.isBlank()) Icons.Default.Lock else Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

private data class Cps3RoutineItem(val week: String, val date: String, val day: String, val time: String, val title: String, val raw: String)

@Composable
private fun Cps3Routine(courseId: String, online: Boolean, onBack: () -> Unit) {
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
    val items = remember(sheet) { cps3RoutineItems(sheet) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "Course Routine") }
        if (loading) item { Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() } }
        if (!loading && items.isEmpty() && sheet?.text.isNullOrBlank()) item { Cps3Message(error ?: if (online) "No routine could be read from the course routine sheet." else "Connect once to load the course routine.") }
        var lastWeek = ""
        items.forEachIndexed { index, item ->
            if (item.week.isNotBlank() && item.week != lastWeek) {
                lastWeek = item.week
                item(key = "cps3-week-$index-${item.week}") { Cps3Section(item.week) }
            }
            item(key = "cps3-routine-$index-${item.date}-${item.title.hashCode()}") {
                Card(shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        if (item.date.isNotBlank() || item.day.isNotBlank()) {
                            Text(listOf(item.date, item.day).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                        }
                        if (item.time.isNotBlank()) Surface(shape = Cps3Pill, color = MaterialTheme.colorScheme.primaryContainer) { Text(item.time, Modifier.padding(horizontal = 10.dp, vertical = 6.dp), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer) }
                        Text(item.title.ifBlank { item.raw }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        sheet?.text?.takeIf { it.isNotBlank() && items.isEmpty() }?.let { routine -> item { Cps3Message(routine) } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

private fun cps3RoutineItems(sheet: NativeCpsRoutineSheet?): List<Cps3RoutineItem> {
    if (sheet == null) return emptyList()
    var currentWeek = ""
    val result = mutableListOf<Cps3RoutineItem>()
    val dateRegex = Regex("""(?i)\b(?:\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}/\d{2,4})\b""")
    val dayRegex = Regex("""(?i)^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$""")
    val weekRegex = Regex("""(?i)\bweek\s*[-–—:]?\s*\d+\b""")
    val timeRegex = Regex("""(?i)(?:Live\s*Class|Exam|Class)?\s*\(?\d{1,2}:\d{2}\s*(?:AM|PM)?\s*(?:-|–|—|to)\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\)?""")
    sheet.rows.forEach { row ->
        val cells = row.map { it.trim() }.filter { it.isNotBlank() }
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
            lower !in excluded && !weekRegex.matches(cell) && !dayRegex.matches(cell) && !dateRegex.matches(cell) && !timeRegex.matches(cell) &&
                lower !in setOf("date", "day", "topic", "class", "schedule", "time", "week")
        }
        val title = content.maxByOrNull { it.length }.orEmpty()
        if (date.isNotBlank() || day.isNotBlank() || time.isNotBlank() || title.isNotBlank()) {
            result += Cps3RoutineItem(currentWeek, date, day, time, title, cells.joinToString(" • "))
        }
    }
    return result
}

@Composable
private fun Cps3Topics(nav: NavHostController, state: NativeUiState, courseId: String, bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val context = LocalContext.current
    var expandedChapter by rememberSaveable(courseId) { mutableStateOf("") }
    var expandedClass by rememberSaveable(courseId) { mutableStateOf("") }
    val topics = bundle?.topics.orEmpty()
    val contentClasses = state.courseContent[courseId]?.classes.orEmpty().associateBy { it.id }
    val orderedGroups = remember(bundle, topics) {
        val used = mutableSetOf<String>()
        buildList {
            bundle?.playlists.orEmpty().sortedBy { it.order }.forEach { playlist ->
                val rows = topics.filter { it.playlistId == playlist.id }
                if (rows.isNotEmpty()) { add(playlist.id to (playlist.title to rows)); used += playlist.id }
            }
            topics.filter { it.playlistId !in used }.groupBy { it.playlistId.ifBlank { it.chapter } }.forEach { (key, rows) -> add(key to (rows.firstOrNull()?.chapter.orEmpty().ifBlank { "Topics" } to rows)) }
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "All Topics") }
        if (orderedGroups.isEmpty()) item { Cps3Message("No timestamped topics are available yet.") }
        orderedGroups.forEach { (chapterId, value) ->
            val (chapterTitle, chapterTopics) = value
            item(key = "cps3-topic-chapter-$chapterId") {
                Card(shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column {
                        Row(Modifier.fillMaxWidth().clickable {
                            expandedChapter = if (expandedChapter == chapterId) "" else chapterId
                            expandedClass = ""
                        }.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Topic, null, Modifier.size(23.dp)); Spacer(Modifier.width(11.dp))
                            Column(Modifier.weight(1f)) { Text(chapterTitle, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text("${chapterTopics.map { it.classId }.distinct().size} classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            Icon(if (expandedChapter == chapterId) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                        }
                        if (expandedChapter == chapterId) {
                            chapterTopics.groupBy { it.classId }.forEach { (classId, classTopics) ->
                                val classTitle = classTopics.firstOrNull()?.classTitle.orEmpty().ifBlank { "Class" }
                                Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), shape = Cps3Small) {
                                    Column {
                                        Row(Modifier.fillMaxWidth().clickable { expandedClass = if (expandedClass == classId) "" else classId }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Default.PlayArrow, null, Modifier.size(20.dp)); Spacer(Modifier.width(9.dp)); Column(Modifier.weight(1f)) { Text(classTitle, fontWeight = FontWeight.Bold); Text("${classTopics.size} topics", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(if (expandedClass == classId) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                                        }
                                        if (expandedClass == classId) {
                                            classTopics.sortedBy { it.videoTimestamp }.forEach { topic ->
                                                val playable = topic.canOpen && contentClasses[classId]?.sourceUrl?.isNotBlank() == true
                                                Row(Modifier.fillMaxWidth().clickable(enabled = playable) {
                                                    val ms = topic.videoTimestamp.toLong().coerceAtLeast(0L) * 1000L
                                                    context.getSharedPreferences("native_player_positions_v2", Context.MODE_PRIVATE).edit().putLong("class:$classId", ms).apply()
                                                    if (PersistentNativePlayer.currentClassId() == classId) runCatching { PersistentNativePlayer.player(context).seekTo(ms) }
                                                    nav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(classId)}")
                                                }.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                                    Surface(shape = Cps3Pill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(cps3Timestamp(topic.videoTimestamp), Modifier.padding(horizontal = 8.dp, vertical = 4.dp), fontWeight = FontWeight.Bold) }
                                                    Spacer(Modifier.width(10.dp)); Text(topic.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold); Icon(if (playable) Icons.Default.PlayArrow else Icons.Default.Lock, null, Modifier.size(18.dp))
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun Cps3Exams(nav: NavHostController, state: NativeUiState, courseId: String, onBack: () -> Unit) {
    val exams = state.cpsCourseExtras[courseId]?.exams.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); Cps3Back(onBack, "Exams") }
        if (exams.isEmpty()) item { Cps3Message("No exam is available for this course yet.") }
        items(exams, key = { it.id }) { exam ->
            Card(Modifier.fillMaxWidth().clickable { nav.navigate("cps-exam/${Uri.encode(courseId)}/${Uri.encode(exam.id)}") }, shape = Cps3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Quiz, null, Modifier.size(23.dp)); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) { Text(exam.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text(buildList { if (exam.duration > 0) add("${exam.duration} min"); if (exam.questionsCount > 0) add("${exam.questionsCount} questions"); if (exam.status.isNotBlank()) add(exam.status) }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable private fun Cps3Tile(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = Cps3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(12.dp).size(24.dp)) }; Spacer(Modifier.width(13.dp)); Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }; Icon(Icons.Default.ArrowForward, null) }
    }
}
@Composable private fun Cps3Back(nav: NavHostController, title: String) = Cps3Back({ nav.popBackStack() }, title)
@Composable private fun Cps3Back(onBack: () -> Unit, title: String) { Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
@Composable private fun Cps3Section(title: String) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold) }
@Composable private fun Cps3Chip(text: String) { Surface(shape = Cps3Pill, color = MaterialTheme.colorScheme.surfaceVariant) { Text(text, Modifier.padding(horizontal = 9.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
@Composable private fun Cps3Status(text: String) { Surface(shape = Cps3Pill, color = if (text.equals("LIVE", true)) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) { Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
@Composable private fun Cps3Message(text: String) { Card(shape = Cps3Small, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) { Text(text, Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) } }

private fun cps3Key(value: String): String = value.lowercase(Locale.getDefault()).replace(Regex("(?i)live"), "").replace(Regex("[^\\p{L}\\p{N}]+"), "")
private fun cps3LiveMatchesClass(live: NativeCpsAcademicLive, item: NativeCpsPlaylistClass): Boolean {
    val classKey = cps3Key(item.title)
    if (classKey.isBlank()) return false
    return listOf(live.title, live.topic).map(::cps3Key).any { it.isNotBlank() && it == classKey }
}
private fun cps3LiveBelongsTo(live: NativeCpsAcademicLive, playlist: NativeCpsPlaylistGroup): Boolean {
    if (live.playlistId.isNotBlank() && live.playlistId == playlist.id) return true
    if (playlist.classes.any { cps3LiveMatchesClass(live, it) }) return true
    val playlistKey = cps3Key(playlist.title)
    return listOf(live.playlistTitle, live.topic).map(::cps3Key).any { key -> key.isNotBlank() && playlistKey.isNotBlank() && (key == playlistKey || key.contains(playlistKey) || playlistKey.contains(key)) }
}
private fun NativeCpsAcademicLive.cps3Running(): Boolean = status.lowercase(Locale.getDefault()) in setOf("live", "running", "ongoing", "started", "live now")
private fun NativeCpsAcademicLive.cps3Upcoming(): Boolean = status.lowercase(Locale.getDefault()) in setOf("upcoming", "scheduled")
private fun NativeCpsAcademicLive.cps3Ended(): Boolean = status.lowercase(Locale.getDefault()) in setOf("ended", "past", "completed")
private fun cps3Timestamp(seconds: Int): String { val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = (safe % 3600) / 60; val s = safe % 60; return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s) }
