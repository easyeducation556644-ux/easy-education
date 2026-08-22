package com.easyeducation.app

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.material.icons.filled.Schedule
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class CpsV3Page { HOME, LIVE, PLAYLIST, ARCHIVES, CLASS, LIVE_EVENT, RESOURCES, ROUTINE, TOPIC_CHAPTERS, TOPIC_CLASSES, TOPIC_ITEMS, EXAMS }
private val CpsV3Card = RoundedCornerShape(20.dp)
private val CpsV3Small = RoundedCornerShape(14.dp)
private val CpsV3Pill = RoundedCornerShape(999.dp)

@Composable
fun NativeCpsCourseExperienceV3(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val academicMap by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    var pageName by rememberSaveable(courseId) { mutableStateOf(CpsV3Page.HOME.name) }
    var playlistId by rememberSaveable(courseId) { mutableStateOf("") }
    var classId by rememberSaveable(courseId) { mutableStateOf("") }
    var liveId by rememberSaveable(courseId) { mutableStateOf("") }
    var topicChapter by rememberSaveable(courseId) { mutableStateOf("") }
    var topicClassId by rememberSaveable(courseId) { mutableStateOf("") }
    var startAtMs by rememberSaveable(courseId) { mutableLongStateOf(0L) }
    val page = runCatching { CpsV3Page.valueOf(pageName) }.getOrDefault(CpsV3Page.HOME)

    LaunchedEffect(courseId, state.online) {
        viewModel.loadCourse(courseId)
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, state.online)
    }

    fun openClass(id: String, seekMs: Long = 0L) {
        classId = id
        startAtMs = seekMs.coerceAtLeast(0L)
        pageName = CpsV3Page.CLASS.name
    }

    BackHandler(enabled = page != CpsV3Page.HOME) {
        pageName = when (page) {
            CpsV3Page.PLAYLIST, CpsV3Page.ARCHIVES, CpsV3Page.LIVE_EVENT -> CpsV3Page.LIVE.name
            CpsV3Page.CLASS -> CpsV3Page.PLAYLIST.name
            CpsV3Page.TOPIC_CLASSES -> CpsV3Page.TOPIC_CHAPTERS.name
            CpsV3Page.TOPIC_ITEMS -> CpsV3Page.TOPIC_CLASSES.name
            else -> CpsV3Page.HOME.name
        }
    }

    val academic = academicMap[courseId]
    when (page) {
        CpsV3Page.HOME -> CpsV3Home(nav, viewModel, state, courseId, academic) { pageName = it.name }
        CpsV3Page.LIVE -> CpsV3Live(
            bundle = academic,
            onBack = { pageName = CpsV3Page.HOME.name },
            onPlaylist = { playlistId = it; pageName = CpsV3Page.PLAYLIST.name },
            onArchives = { pageName = CpsV3Page.ARCHIVES.name },
            onLive = { liveId = it; pageName = CpsV3Page.LIVE_EVENT.name },
        )
        CpsV3Page.PLAYLIST -> CpsV3Playlist(academic, playlistId, onBack = { pageName = CpsV3Page.LIVE.name }, onClass = ::openClass)
        CpsV3Page.ARCHIVES -> CpsV3Archives(academic, onBack = { pageName = CpsV3Page.LIVE.name }) { playlistId = it; pageName = CpsV3Page.PLAYLIST.name }
        CpsV3Page.CLASS -> CpsV3ClassPage(state, academic, classId, startAtMs, onBack = { pageName = CpsV3Page.PLAYLIST.name })
        CpsV3Page.LIVE_EVENT -> CpsV3LiveEvent(state, academic, liveId, onBack = { pageName = CpsV3Page.LIVE.name })
        CpsV3Page.RESOURCES -> CpsV3Resources(academic, onBack = { pageName = CpsV3Page.HOME.name })
        CpsV3Page.ROUTINE -> CpsV3Routine(academic, onBack = { pageName = CpsV3Page.HOME.name })
        CpsV3Page.TOPIC_CHAPTERS -> CpsV3TopicChapters(academic, onBack = { pageName = CpsV3Page.HOME.name }) { chapter -> topicChapter = chapter; pageName = CpsV3Page.TOPIC_CLASSES.name }
        CpsV3Page.TOPIC_CLASSES -> CpsV3TopicClasses(academic, topicChapter, onBack = { pageName = CpsV3Page.TOPIC_CHAPTERS.name }) { id -> topicClassId = id; pageName = CpsV3Page.TOPIC_ITEMS.name }
        CpsV3Page.TOPIC_ITEMS -> CpsV3TopicItems(academic, topicClassId, onBack = { pageName = CpsV3Page.TOPIC_CLASSES.name }) { topic ->
            playlistId = topic.playlistId
            openClass(topic.classId, topic.videoTimestamp.toLong() * 1000L)
        }
        CpsV3Page.EXAMS -> CpsV3Exams(state, courseId, onBack = { pageName = CpsV3Page.HOME.name })
    }
}

@Composable
private fun CpsV3Home(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    academic: NativeCpsAcademicBundle?,
    onPage: (CpsV3Page) -> Unit,
) {
    val entry = state.cpsCourses.firstOrNull { it.course.id == courseId }
    val course = state.courseContent[courseId]?.course ?: entry?.course
    val access = academic?.hasAccess ?: viewModel.hasCpsAccess(courseId)
    if (course == null) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CpsV3Back({ nav.popBackStack() }, "CPS Course")
            CircularProgressIndicator()
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back({ nav.popBackStack() }, course.title) }
        item {
            Card(shape = CpsV3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) AsyncImage(course.thumbnailUrl, course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { CpsV3Chip("CPS"); CpsV3Chip("LIVE + INSTANT") }
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (access) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp)); Text(if (access) "Access active" else "Preview mode", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        item { CpsV3Tile("Live Classes", "All LIVE playlists and current sessions", Icons.Default.LiveTv) { onPage(CpsV3Page.LIVE) } }
        item { CpsV3Tile("Exams", "Timed exams with saved results", Icons.Default.Quiz) { onPage(CpsV3Page.EXAMS) } }
        item { CpsV3Tile("Slides & Practice Sheet", "Chapter-wise class resources", Icons.Default.Description) { onPage(CpsV3Page.RESOURCES) } }
        item { CpsV3Tile("Routine", "Course routine from CPS", Icons.Default.CalendarMonth) { onPage(CpsV3Page.ROUTINE) } }
        item { CpsV3Tile("All Topics", "Chapter → class → video timestamps", Icons.Default.Topic) { onPage(CpsV3Page.TOPIC_CHAPTERS) } }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun CpsV3Live(
    bundle: NativeCpsAcademicBundle?,
    onBack: () -> Unit,
    onPlaylist: (String) -> Unit,
    onArchives: () -> Unit,
    onLive: (String) -> Unit,
) {
    val livePlaylists = bundle?.playlists.orEmpty().filter { it.type.equals("LIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }
    val scheduled = bundle?.liveClasses.orEmpty().filter { it.cpsV3Running() || it.cpsV3Upcoming() || it.cpsV3Ended() }.sortedByDescending { cpsV3TimeMillis(it.startTime) ?: 0L }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, "Live Classes") }
        items(scheduled, key = { "live-event-${it.id}" }) { live ->
            val playable = live.hasAccess && !live.cpsV3Upcoming() && live.cpsV3PlayableUrl().isNotBlank()
            Card(Modifier.fillMaxWidth().clickable(enabled = playable) { onLive(live.id) }, shape = CpsV3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(14.dp), color = if (live.cpsV3Running()) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) { Icon(Icons.Default.LiveTv, null, Modifier.padding(11.dp).size(23.dp)) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(live.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val status = when { live.cpsV3Running() -> "LIVE"; live.cpsV3Upcoming() -> "UPCOMING"; else -> "ENDED" }
                        Text(listOf(status, cpsV3DateTime(live.startTime)).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(if (playable) Icons.Default.ArrowForward else if (live.cpsV3Upcoming()) Icons.Default.Schedule else Icons.Default.Lock, null)
                }
            }
        }
        items(livePlaylists, key = { "live-playlist-${it.id}" }) { playlist -> CpsV3PlaylistCard(playlist.title, playlist.classes.size, archive = false) { onPlaylist(playlist.id) } }
        if (archives.isNotEmpty()) item {
            Card(Modifier.fillMaxWidth().clickable(onClick = onArchives), shape = CpsV3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.tertiaryContainer) { Icon(Icons.Default.Folder, null, Modifier.padding(11.dp).size(23.dp)) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text("Archives", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text("${archives.size} archive playlists • ${archives.sumOf { it.classes.size }} classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
        if (scheduled.isEmpty() && livePlaylists.isEmpty() && archives.isEmpty()) item { CpsV3Message("No live class is available yet.") }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun CpsV3Archives(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onPlaylist: (String) -> Unit) {
    val archives = bundle?.playlists.orEmpty().filter { it.type.equals("ARCHIVE", true) && it.classes.isNotEmpty() }.sortedBy { it.order }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, "Archives") }
        items(archives, key = { it.id }) { playlist -> CpsV3PlaylistCard(playlist.title, playlist.classes.size, archive = true) { onPlaylist(playlist.id) } }
        if (archives.isEmpty()) item { CpsV3Message("No archive is available yet.") }
    }
}

@Composable
private fun CpsV3Playlist(bundle: NativeCpsAcademicBundle?, playlistId: String, onBack: () -> Unit, onClass: (String, Long) -> Unit) {
    val playlist = bundle?.playlists.orEmpty().firstOrNull { it.id == playlistId }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, playlist?.title ?: "Classes") }
        val classes = playlist?.classes.orEmpty()
        items(classes, key = { "class-${playlist?.id}-${it.id}" }) { item ->
            val playable = item.hasAccess && item.videoUrl.isNotBlank()
            Card(Modifier.fillMaxWidth().clickable(enabled = playable) { onClass(item.id, 0L) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) { Icon(if (playable) Icons.Default.PlayArrow else Icons.Default.Lock, null, Modifier.padding(10.dp).size(21.dp)) }
                    Spacer(Modifier.width(11.dp))
                    Column(Modifier.weight(1f)) { Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); val meta = listOf(item.cdnType, if (item.timestamps.isNotBlank()) "Topics available" else "").filter { it.isNotBlank() }.joinToString(" • "); if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
        if (classes.isEmpty()) item { CpsV3Message("No class is available in this playlist yet.") }
    }
}

@Composable
private fun CpsV3ClassPage(state: NativeUiState, bundle: NativeCpsAcademicBundle?, classId: String, startAtMs: Long, onBack: () -> Unit) {
    val context = LocalContext.current
    val classItem = bundle?.playlists.orEmpty().flatMap { it.classes }.firstOrNull { it.id == classId }
    val classResources = bundle?.resources.orEmpty().filter { it.classId == classId }
    val classTopics = bundle?.topics.orEmpty().filter { it.classId == classId }.sortedBy { it.videoTimestamp }
    val source = classItem?.videoUrl.orEmpty()
    val title = classItem?.title ?: "Class"
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                if (classItem != null && classItem.hasAccess && source.isNotBlank()) CpsV3ResolvedInlinePlayer(classItem.id, classItem.title, source, classItem.cdnType, state.online, startAtMs)
                else Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black), contentAlignment = Alignment.Center) { Text(if (source.isBlank()) "Video source is unavailable" else "This class is locked", color = Color.White) }
            }
        }
        item { Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold); classItem?.cdnType?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
        item { CpsV3Section("Resources") }
        if (classResources.isEmpty()) item { Box(Modifier.padding(horizontal = 16.dp)) { CpsV3Message("No file is attached to this class.") } }
        items(classResources, key = { "class-resource-${it.id}" }) { resource ->
            Card(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clickable(enabled = !resource.locked && resource.url.isNotBlank()) { NativeResourceViewerActivity.open(context, resource.title, resource.url) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Description, null); Spacer(Modifier.width(10.dp)); Text(resource.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis); Icon(Icons.Default.ArrowForward, null) }
            }
        }
        if (classTopics.isNotEmpty()) item { CpsV3Section("Topics") }
        items(classTopics, key = { "class-topic-${it.id}" }) { topic ->
            Card(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clickable(enabled = topic.canOpen && source.isNotBlank()) { if (PersistentNativePlayer.currentClassId() == classId) PersistentNativePlayer.player(context).seekTo(topic.videoTimestamp.toLong() * 1000L) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = CpsV3Pill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(cpsV3Timestamp(topic.videoTimestamp), Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold) }; Spacer(Modifier.width(10.dp)); Text(topic.title, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun CpsV3LiveEvent(state: NativeUiState, bundle: NativeCpsAcademicBundle?, liveId: String, onBack: () -> Unit) {
    val live = bundle?.liveClasses.orEmpty().firstOrNull { it.id == liveId }
    val source = live?.cpsV3PlayableUrl().orEmpty()
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(live?.title ?: "Live class", Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                if (live != null && live.hasAccess && source.isNotBlank()) CpsV3ResolvedInlinePlayer("cps-live:${live.id}", live.title, source, live.platform, state.online, 0L)
                else Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black), contentAlignment = Alignment.Center) { Text("This class is not playable yet", color = Color.White) }
            }
        }
        item { Column(Modifier.padding(horizontal = 16.dp)) { Text(live?.title ?: "Live class", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold); live?.startTime?.takeIf { it.isNotBlank() }?.let { Text(cpsV3DateTime(it), color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
    }
}

@Composable
private fun CpsV3Resources(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val context = LocalContext.current
    val grouped = bundle?.resources.orEmpty().groupBy { it.chapter.ifBlank { "Resources" } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, "Slides & Practice Sheet") }
        grouped.forEach { (chapter, resources) ->
            item(key = "resources-title-$chapter") { CpsV3Section(chapter, inset = false) }
            items(resources, key = { it.id }) { resource ->
                Card(Modifier.fillMaxWidth().clickable(enabled = !resource.locked && resource.url.isNotBlank()) { NativeResourceViewerActivity.open(context, resource.title, resource.url) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Description, null); Spacer(Modifier.width(10.dp)); Text(resource.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis); Icon(if (resource.locked) Icons.Default.Lock else Icons.Default.ArrowForward, null) }
                }
            }
        }
        if (grouped.isEmpty()) item { CpsV3Message("No slides or practice sheets are available yet.") }
    }
}

@Composable
private fun CpsV3Routine(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val routine = bundle?.routine.orEmpty().trim()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text("Routine", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
        when {
            routine.startsWith("http://") || routine.startsWith("https://") -> CpsV3RoutineWeb(routine, Modifier.fillMaxSize())
            routine.isNotBlank() -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) { item { CpsV3Message(cpsV3CleanText(routine)) } }
            bundle?.calendarEvents.orEmpty().isNotEmpty() -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { items(bundle?.calendarEvents.orEmpty().sortedBy { cpsV3TimeMillis(it.startTime) ?: Long.MAX_VALUE }, key = { it.id }) { event -> Card(Modifier.fillMaxWidth(), shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Schedule, null); Spacer(Modifier.width(10.dp)); Column { Text(event.title, fontWeight = FontWeight.SemiBold); Text(cpsV3DateTime(event.startTime), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } } } }
            else -> Box(Modifier.fillMaxSize().padding(16.dp)) { CpsV3Message("Routine is not available yet.") }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CpsV3RoutineWeb(url: String, modifier: Modifier = Modifier) {
    var view: WebView? by remember(url) { mutableStateOf(null) }
    DisposableEffect(url) { onDispose { view?.stopLoading(); view?.loadUrl("about:blank"); view?.destroy(); view = null } }
    AndroidView(modifier = modifier, factory = { context -> WebView(context).apply { view = this; settings.javaScriptEnabled = true; settings.domStorageEnabled = true; settings.loadsImagesAutomatically = true; settings.setSupportZoom(true); settings.builtInZoomControls = true; settings.displayZoomControls = false; webViewClient = object : WebViewClient() { override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean { val host = request.url.host.orEmpty().lowercase(); return request.isForMainFrame && !(host.endsWith("google.com") || host.endsWith("googleusercontent.com") || host.endsWith("gstatic.com")) } }; loadUrl(url) } })
}

@Composable
private fun CpsV3TopicChapters(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onChapter: (String) -> Unit) {
    val grouped = bundle?.topics.orEmpty().groupBy { it.chapter.ifBlank { "Topics" } }
    val playlistTitles = bundle?.playlists.orEmpty().map { it.title }
    val ordered = playlistTitles.filter { grouped.containsKey(it) } + grouped.keys.filterNot { it in playlistTitles }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, "All Topics") }
        items(ordered.distinct(), key = { "topic-chapter-$it" }) { chapter -> val topics = grouped[chapter].orEmpty(); val classes = topics.map { it.classId }.distinct().size; CpsV3PlaylistCard(chapter, classes, archive = false, suffix = "classes") { onChapter(chapter) } }
        if (grouped.isEmpty()) item { CpsV3Message("No timestamped topics are available yet.") }
    }
}

@Composable
private fun CpsV3TopicClasses(bundle: NativeCpsAcademicBundle?, chapter: String, onBack: () -> Unit, onClass: (String) -> Unit) {
    val topics = bundle?.topics.orEmpty().filter { it.chapter == chapter }
    val grouped = topics.groupBy { it.classId }
    val classMap = bundle?.playlists.orEmpty().flatMap { it.classes }.associateBy { it.id }
    val ids = grouped.keys.sortedBy { id -> classMap[id]?.order ?: Int.MAX_VALUE }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, chapter.ifBlank { "Classes" }) }
        items(ids, key = { "topic-class-$it" }) { id -> val title = classMap[id]?.title ?: grouped[id]?.firstOrNull()?.classTitle ?: "Class"; CpsV3PlaylistCard(title, grouped[id].orEmpty().size, archive = false, suffix = "topics") { onClass(id) } }
        if (ids.isEmpty()) item { CpsV3Message("No timestamped class is available in this chapter.") }
    }
}

@Composable
private fun CpsV3TopicItems(bundle: NativeCpsAcademicBundle?, classId: String, onBack: () -> Unit, onTopic: (NativeCpsTopic) -> Unit) {
    val topics = bundle?.topics.orEmpty().filter { it.classId == classId }.sortedBy { it.videoTimestamp }
    val title = bundle?.playlists.orEmpty().flatMap { it.classes }.firstOrNull { it.id == classId }?.title ?: topics.firstOrNull()?.classTitle ?: "Topics"
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, title) }
        items(topics, key = { it.id }) { topic -> Card(Modifier.fillMaxWidth().clickable(enabled = topic.canOpen) { onTopic(topic) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = CpsV3Pill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(cpsV3Timestamp(topic.videoTimestamp), Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold) }; Spacer(Modifier.width(10.dp)); Text(topic.title, Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis); Icon(Icons.Default.PlayArrow, null) } } }
    }
}

@Composable
private fun CpsV3Exams(state: NativeUiState, courseId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val exams = state.cpsCourseExtras[courseId]?.exams.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsV3Back(onBack, "Exams") }
        items(exams, key = { "safe-exam-${it.id}" }) { exam -> Card(Modifier.fillMaxWidth().clickable(enabled = exam.id.isNotBlank()) { NativeCpsExamSafeActivity.open(context, courseId, exam.id) }, shape = CpsV3Small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) { Icon(Icons.Default.Quiz, null, Modifier.padding(9.dp).size(21.dp)) }; Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(exam.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); val meta = buildList { if (exam.duration > 0) add("${exam.duration} min"); if (exam.questionsCount > 0) add("${exam.questionsCount} questions"); if (exam.status.isNotBlank()) add(exam.status) }; if (meta.isNotEmpty()) Text(meta.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) } } }
        if (exams.isEmpty()) item { CpsV3Message("No exam is available for this course yet.") }
    }
}

@Composable
private fun CpsV3ResolvedInlinePlayer(classId: String, title: String, sourceUrl: String, cdnType: String, online: Boolean, startAtMs: Long) {
    val context = LocalContext.current
    var resolved by remember(sourceUrl, cdnType) { mutableStateOf("") }
    var resolving by remember(sourceUrl, cdnType) { mutableStateOf(true) }
    LaunchedEffect(sourceUrl, cdnType, online) { resolving = true; resolved = if (online) NativeCpsProviderResolver.resolve(sourceUrl, cdnType) else sourceUrl; resolving = false }
    val active = resolved.ifBlank { sourceUrl }
    val unresolvedEmbed = active == sourceUrl && cpsV3LooksEmbed(sourceUrl, cdnType)
    when {
        resolving -> Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Color.White) }
        unresolvedEmbed -> CpsV3SecureEmbed(active)
        else -> {
            NativeInlinePlayer(classId = classId, sourceUrl = active, online = online, title = title, requestedHeight = 720)
            if (startAtMs > 0L) LaunchedEffect(classId, active, startAtMs) { repeat(12) { delay(250L); val player = PersistentNativePlayer.player(context); if (PersistentNativePlayer.currentClassId() == classId && player.mediaItemCount > 0) { player.seekTo(startAtMs); return@LaunchedEffect } } }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CpsV3SecureEmbed(url: String) {
    var view: WebView? by remember(url) { mutableStateOf(null) }
    DisposableEffect(url) { onDispose { view?.stopLoading(); view?.loadUrl("about:blank"); view?.destroy(); view = null } }
    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { context -> WebView(context).apply { view = this; setBackgroundColor(android.graphics.Color.BLACK); settings.javaScriptEnabled = true; settings.domStorageEnabled = true; settings.mediaPlaybackRequiresUserGesture = false; settings.setSupportMultipleWindows(false); settings.javaScriptCanOpenWindowsAutomatically = false; webViewClient = object : WebViewClient() { override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.isForMainFrame && request.url.toString() != url }; loadUrl(url) } })
    }
}

@Composable
private fun CpsV3PlaylistCard(title: String, count: Int, archive: Boolean, suffix: String = "classes", onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = CpsV3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) { Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(14.dp), color = if (archive) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.secondaryContainer) { Icon(if (archive) Icons.Default.Folder else Icons.Default.LiveTv, null, Modifier.padding(11.dp).size(23.dp)) }; Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text("$count $suffix", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) } }
}

@Composable
private fun CpsV3Tile(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = CpsV3Card, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) { Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(11.dp).size(24.dp)) }; Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ArrowForward, null) } }
}

@Composable
private fun CpsV3Back(onBack: () -> Unit, title: String) { Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) } }

@Composable
private fun CpsV3Chip(label: String) { Surface(shape = CpsV3Pill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(label, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }

@Composable
private fun CpsV3Section(title: String, inset: Boolean = true) { Text(title, Modifier.padding(horizontal = if (inset) 16.dp else 0.dp, vertical = 3.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold) }

@Composable
private fun CpsV3Message(message: String) { Card(Modifier.fillMaxWidth(), shape = CpsV3Small, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) { Text(message, Modifier.padding(15.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) } }

private fun NativeCpsAcademicLive.cpsV3Running(): Boolean = status.lowercase(Locale.getDefault()) in setOf("live", "running", "ongoing", "started", "live now")
private fun NativeCpsAcademicLive.cpsV3Upcoming(): Boolean = status.lowercase(Locale.getDefault()).contains("upcoming") || (!cpsV3Running() && (cpsV3TimeMillis(startTime) ?: 0L) > System.currentTimeMillis())
private fun NativeCpsAcademicLive.cpsV3Ended(): Boolean = status.lowercase(Locale.getDefault()) in setOf("ended", "past", "completed", "complete") || (!cpsV3Running() && !cpsV3Upcoming())
private fun NativeCpsAcademicLive.cpsV3PlayableUrl(): String = if (cpsV3Running()) url else recordings.firstOrNull { it.url.isNotBlank() }?.url ?: url
private fun cpsV3LooksEmbed(url: String, cdnType: String): Boolean { val host = runCatching { Uri.parse(url).host.orEmpty().lowercase() }.getOrDefault(""); return host.contains("mediadelivery.net") || url.contains("/embed/", true) || cdnType.contains("bunny", true) || cdnType.contains("iframe", true) }
private fun cpsV3TimeMillis(value: String): Long? { if (value.isBlank()) return null; return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull() ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull() ?: value.toLongOrNull()?.let { if (it < 10_000_000_000L) it * 1000L else it } }
private fun cpsV3DateTime(value: String): String { val ms = cpsV3TimeMillis(value) ?: return value; return runCatching { DateTimeFormatter.ofPattern("dd MMM yyyy • h:mm a").withZone(ZoneId.of("Asia/Dhaka")).format(Instant.ofEpochMilli(ms)) }.getOrDefault(value) }
private fun cpsV3Timestamp(seconds: Int): String { val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = (safe % 3600) / 60; val s = safe % 60; return if (h > 0) "%d:%02d:%02d".format(Locale.US, h, m, s) else "%02d:%02d".format(Locale.US, m, s) }
private fun cpsV3CleanText(value: String): String = runCatching { android.text.Html.fromHtml(value, android.text.Html.FROM_HTML_MODE_LEGACY).toString() }.getOrDefault(value).trim()
