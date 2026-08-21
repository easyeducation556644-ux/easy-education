package com.easyeducation.app

import android.content.Context
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Topic
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

private val AcademicCard = RoundedCornerShape(20.dp)
private val AcademicSmall = RoundedCornerShape(14.dp)
private val AcademicPill = RoundedCornerShape(999.dp)
private val DhakaZone: ZoneId = ZoneId.of("Asia/Dhaka")

@Composable
fun NativeCpsCatalogScreenV2(nav: NavHostController, state: NativeUiState) {
    var query by rememberSaveable { mutableStateOf("") }
    val now = System.currentTimeMillis()
    val filtered = remember(state.cpsCourses, query) {
        val needle = query.trim().lowercase(Locale.getDefault())
        if (needle.isBlank()) state.cpsCourses
        else state.cpsCourses.filter { entry ->
            val c = entry.course
            listOf(c.title, c.description, c.courseFormat).joinToString(" ").lowercase(Locale.getDefault()).contains(needle)
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "CPS") }
        item {
            Card(
                shape = AcademicCard,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Box(
                    Modifier.fillMaxWidth().background(
                        Brush.linearGradient(
                            listOf(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.secondaryContainer),
                        ),
                    ),
                ) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("CPS Learning Space", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Text("Live classes, exams, resources, routine and topic timestamps — in one place.", color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = .78f))
                        val unlocked = state.cpsCourses.count { it.hasAccess && (it.accessExpiresAtMs == 0L || it.accessExpiresAtMs > now) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AcademicChip("${state.cpsCourses.size} courses")
                            AcademicChip("$unlocked unlocked")
                        }
                    }
                }
            }
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = AcademicPill,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                placeholder = { Text("Search CPS courses") },
            )
        }
        if (state.cpsLiveHighlights.isNotEmpty()) {
            item { AcademicSection("Live / Today") }
            items(state.cpsLiveHighlights.take(5), key = { "catalog-live-${it.courseId}-${it.id}" }) { live ->
                Card(
                    Modifier.fillMaxWidth().clickable {
                        if (live.courseId.isNotBlank()) nav.navigate("course/${Uri.encode(live.courseId)}")
                    },
                    shape = AcademicSmall,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.errorContainer) {
                            Icon(Icons.Default.LiveTv, null, Modifier.padding(10.dp).size(21.dp), tint = MaterialTheme.colorScheme.onErrorContainer)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(live.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOf(live.courseTitle, live.startTime).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        item { AcademicSection(if (query.isBlank()) "All CPS Courses" else "Search Results") }
        if (filtered.isEmpty()) {
            item { AcademicMessage(if (query.isBlank()) "No CPS course is available yet." else "No CPS course matches your search.") }
        } else {
            items(filtered, key = { it.course.id }) { entry ->
                val active = entry.hasAccess && (entry.accessExpiresAtMs == 0L || entry.accessExpiresAtMs > now)
                Card(
                    Modifier.fillMaxWidth().clickable { nav.navigate("course/${Uri.encode(entry.course.id)}") },
                    shape = AcademicCard,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column {
                        if (entry.course.thumbnailUrl.isNotBlank()) {
                            AsyncImage(entry.course.thumbnailUrl, entry.course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                        }
                        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                AcademicChip("CPS")
                                AcademicChip("LIVE + INSTANT")
                            }
                            Text(entry.course.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            if (entry.course.description.isNotBlank()) Text(entry.course.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (active) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(17.dp), tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(6.dp))
                                Text(if (active) "Access active" else "Preview available", style = MaterialTheme.typography.labelMedium)
                                Spacer(Modifier.weight(1f))
                                Icon(Icons.Default.ArrowForward, null, Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
fun NativeCpsCourseDashboard(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    LaunchedEffect(courseId) {
        viewModel.loadCourse(courseId)
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, state.online)
    }
    val entry = state.cpsCourses.firstOrNull { it.course.id == courseId }
    val course = state.courseContent[courseId]?.course ?: entry?.course
    val academic = bundles[courseId]
    val access = academic?.hasAccess ?: viewModel.hasCpsAccess(courseId)

    if (course == null) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AcademicBack(nav, "CPS Course")
            repeat(5) { Box(Modifier.fillMaxWidth().height(74.dp).background(MaterialTheme.colorScheme.surfaceVariant, AcademicSmall)) }
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, course.title) }
        item {
            Card(shape = AcademicCard, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) AsyncImage(course.thumbnailUrl, course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AcademicChip("CPS"); AcademicChip("LIVE + INSTANT") }
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        if (course.description.isNotBlank()) Text(course.description, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (access) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(18.dp), tint = if (access) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(6.dp))
                            Text(if (access) "Access active" else "Preview mode", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        item { AcademicDashboardTile("Live Classes", "Part-wise live, upcoming and recorded classes", Icons.Default.LiveTv) { nav.navigate("cps-live-groups/${Uri.encode(courseId)}") } }
        item { AcademicDashboardTile("Exams", "Timed exams, answers and saved results", Icons.Default.Quiz) { nav.navigate("cps-exams/${Uri.encode(courseId)}") } }
        item { AcademicDashboardTile("Slides & Practice Sheet", "Chapter-wise notes, slides and practice resources", Icons.Default.Description) { nav.navigate("cps-resources/${Uri.encode(courseId)}") } }
        item { AcademicDashboardTile("Routine", "Calendar view for classes and exams", Icons.Default.CalendarMonth) { nav.navigate("cps-routine/${Uri.encode(courseId)}") } }
        item { AcademicDashboardTile("All Topics", "Chapter-wise video topics with exact timestamps", Icons.Default.Topic) { nav.navigate("cps-topics/${Uri.encode(courseId)}") } }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
fun NativeCpsLiveGroupsScreen(nav: NavHostController, state: NativeUiState, courseId: String) {
    val bundle = rememberAcademicBundle(courseId, state.online)
    val live = bundle?.liveClasses.orEmpty()
    val grouped = live.groupBy { it.playlistId.ifBlank { it.playlistTitle } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "Live Classes") }
        if (grouped.isEmpty()) item { AcademicMessage(if (state.online) "No live class group is available for this course." else "Connect once to load live class groups.") }
        grouped.forEach { (groupId, classes) ->
            val title = classes.firstOrNull()?.playlistTitle?.ifBlank { "Live Classes" } ?: "Live Classes"
            val running = classes.any { it.isRunningLive() }
            item(key = "live-group-$groupId") {
                Card(
                    Modifier.fillMaxWidth().clickable { nav.navigate("cps-live-group/${Uri.encode(courseId)}/${Uri.encode(groupId)}") },
                    shape = AcademicCard,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(14.dp), color = if (running) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
                            Icon(Icons.Default.LiveTv, null, Modifier.padding(11.dp).size(23.dp), tint = if (running) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (running) AcademicStatusChip("LIVE")
                            }
                            Text("${classes.size} class${if (classes.size == 1) "" else "es"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
fun NativeCpsLiveGroupScreen(nav: NavHostController, state: NativeUiState, courseId: String, groupId: String) {
    val context = LocalContext.current
    val bundle = rememberAcademicBundle(courseId, state.online)
    val classes = bundle?.liveClasses.orEmpty().filter { it.playlistId == groupId || (it.playlistId.isBlank() && it.playlistTitle == groupId) }
        .sortedByDescending { parseAcademicTime(it.startTime) ?: 0L }
    val title = classes.firstOrNull()?.playlistTitle ?: "Live Classes"

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, title) }
        if (classes.isEmpty()) item { AcademicMessage("No live class is available in this part yet.") }
        items(classes, key = { "academic-live-${it.id}" }) { live ->
            Card(shape = AcademicSmall, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Surface(shape = CircleShape, color = if (live.isRunningLive()) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
                            Icon(Icons.Default.LiveTv, null, Modifier.padding(9.dp).size(20.dp), tint = if (live.isRunningLive()) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(live.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val meta = listOf(formatAcademicDateTime(live.startTime), live.status.uppercase(Locale.getDefault()), live.platform).filter { it.isNotBlank() }.joinToString(" • ")
                            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (live.isRunningLive() && live.hasAccess && live.url.isNotBlank()) {
                        Button(onClick = { NativeCpsLivePlayerActivity.openLive(context, live.title, live.url, live.id) }, modifier = Modifier.fillMaxWidth(), shape = AcademicPill) { Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text("Watch Live") }
                    } else if (live.status.lowercase(Locale.getDefault()) in setOf("upcoming", "scheduled")) {
                        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth(), shape = AcademicPill) { Icon(Icons.Default.Schedule, null); Spacer(Modifier.width(6.dp)); Text("Upcoming") }
                    }
                    if (live.recordings.isNotEmpty()) {
                        Text("Recordings", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
                        live.recordings.forEach { recording ->
                            OutlinedButton(
                                onClick = { NativeCpsLivePlayerActivity.openRecording(context, recording.title.ifBlank { live.title }, recording.url, "${live.id}:${recording.id}") },
                                enabled = live.hasAccess && recording.url.isNotBlank(),
                                modifier = Modifier.fillMaxWidth(),
                                shape = AcademicPill,
                            ) { Icon(if (recording.url.isNotBlank()) Icons.Default.PlayArrow else Icons.Default.Lock, null); Spacer(Modifier.width(6.dp)); Text(recording.title) }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeCpsResourcesScreen(nav: NavHostController, state: NativeUiState, courseId: String) {
    val context = LocalContext.current
    val bundle = rememberAcademicBundle(courseId, state.online)
    val grouped = bundle?.resources.orEmpty().groupBy { it.chapter.ifBlank { "Resources" } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "Slides & Practice Sheet") }
        if (grouped.isEmpty()) item { AcademicMessage("No slides or practice resources are available yet.") }
        grouped.forEach { (chapter, resources) ->
            item(key = "resource-header-$chapter") { AcademicSection(chapter) }
            items(resources, key = { it.id }) { resource ->
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = !resource.locked && resource.url.isNotBlank()) {
                        NativeResourceViewerActivity.open(context, resource.title, resource.url)
                    },
                    shape = AcademicSmall,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                            Icon(Icons.Default.Description, null, Modifier.padding(9.dp).size(21.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(resource.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(resource.kind.replace('-', ' ').ifBlank { "resource" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(if (resource.locked || resource.url.isBlank()) Icons.Default.Lock else Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeCpsRoutineScreen(nav: NavHostController, state: NativeUiState, courseId: String) {
    val bundle = rememberAcademicBundle(courseId, state.online)
    var month by rememberSaveable { mutableStateOf(YearMonth.now(DhakaZone).toString()) }
    val currentMonth = runCatching { YearMonth.parse(month) }.getOrElse { YearMonth.now(DhakaZone) }
    val events = bundle?.calendarEvents.orEmpty()
    val byDate = events.groupBy { event -> parseAcademicDate(event.startTime) }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "Routine") }
        item {
            Card(shape = AcademicCard, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { month = currentMonth.minusMonths(1).toString() }) { Text("‹", style = MaterialTheme.typography.headlineSmall) }
                        Text(currentMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy")), Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleLarge)
                        IconButton(onClick = { month = currentMonth.plusMonths(1).toString() }) { Text("›", style = MaterialTheme.typography.headlineSmall) }
                    }
                    val days = listOf("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")
                    Row(Modifier.fillMaxWidth()) { days.forEach { day -> Text(day, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
                    val first = currentMonth.atDay(1)
                    val sundayIndex = first.dayOfWeek.value % 7
                    val cells = buildList<LocalDate?> {
                        repeat(sundayIndex) { add(null) }
                        for (day in 1..currentMonth.lengthOfMonth()) add(currentMonth.atDay(day))
                        while (size % 7 != 0) add(null)
                    }
                    cells.chunked(7).forEach { week ->
                        Row(Modifier.fillMaxWidth()) {
                            week.forEach { date ->
                                val hasEvents = date != null && byDate[date].orEmpty().isNotEmpty()
                                Box(Modifier.weight(1f).height(44.dp), contentAlignment = Alignment.Center) {
                                    if (date != null) {
                                        Surface(shape = CircleShape, color = if (hasEvents) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface) {
                                            Text(date.dayOfMonth.toString(), Modifier.padding(9.dp), fontWeight = if (hasEvents) FontWeight.ExtraBold else FontWeight.Normal)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        val monthEvents = events.filter { parseAcademicDate(it.startTime)?.let { date -> YearMonth.from(date) == currentMonth } == true }.sortedBy { parseAcademicTime(it.startTime) ?: Long.MAX_VALUE }
        if (monthEvents.isNotEmpty()) {
            item { AcademicSection("Schedule") }
            items(monthEvents, key = { it.id }) { event ->
                Card(shape = AcademicSmall, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                            Icon(if (event.kind == "live") Icons.Default.LiveTv else Icons.Default.EventAvailable, null, Modifier.padding(9.dp).size(19.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(event.title, fontWeight = FontWeight.SemiBold)
                            Text(formatAcademicDateTime(event.startTime), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (event.status.isNotBlank()) AcademicStatusChip(event.status.uppercase(Locale.getDefault()))
                    }
                }
            }
        }
        bundle?.routine?.takeIf { it.isNotBlank() }?.let { routine ->
            item { AcademicSection("Course Routine") }
            item { AcademicMessage(cleanAcademicText(routine)) }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeCpsTopicsScreen(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState, courseId: String) {
    val context = LocalContext.current
    val bundle = rememberAcademicBundle(courseId, state.online)
    LaunchedEffect(courseId) { viewModel.loadCourse(courseId) }
    val grouped = bundle?.topics.orEmpty().groupBy { it.chapter.ifBlank { "Topics" } }
    val classes = state.courseContent[courseId]?.classes.orEmpty()

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "All Topics") }
        if (grouped.isEmpty()) item { AcademicMessage("No timestamped topics are available for this course yet.") }
        grouped.forEach { (chapter, topics) ->
            item(key = "topic-header-$chapter") { AcademicSection(chapter) }
            items(topics, key = { it.id }) { topic ->
                val classItem = classes.firstOrNull { it.id == topic.classId }
                val playable = topic.canOpen && classItem?.sourceUrl?.isNotBlank() == true
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = playable) {
                        val source = classItem?.sourceUrl.orEmpty()
                        if (source.isBlank()) {
                            Toast.makeText(context, "This class is still loading. Pull to refresh and retry.", Toast.LENGTH_SHORT).show()
                        } else {
                            NativeCpsLivePlayerActivity.openRecording(
                                context,
                                topic.title,
                                source,
                                topic.classId,
                                topic.videoTimestamp.toLong() * 1000L,
                            )
                        }
                    },
                    shape = AcademicSmall,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = AcademicPill, color = MaterialTheme.colorScheme.secondaryContainer) {
                            Text(formatTimestamp(topic.videoTimestamp), Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(topic.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (topic.classTitle.isNotBlank()) Text(topic.classTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(if (playable) Icons.Default.PlayArrow else Icons.Default.Lock, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
fun NativeCpsExamsScreen(nav: NavHostController, state: NativeUiState, courseId: String) {
    val exams = state.cpsCourseExtras[courseId]?.exams.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); AcademicBack(nav, "Exams") }
        if (exams.isEmpty()) item { AcademicMessage("No exam is available for this course yet.") }
        items(exams, key = { it.id }) { exam ->
            Card(
                Modifier.fillMaxWidth().clickable { nav.navigate("cps-exam/${Uri.encode(courseId)}/${Uri.encode(exam.id)}") },
                shape = AcademicSmall,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                        Icon(Icons.Default.Quiz, null, Modifier.padding(9.dp).size(21.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(exam.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val meta = buildList {
                            if (exam.duration > 0) add("${exam.duration} min")
                            if (exam.questionsCount > 0) add("${exam.questionsCount} questions")
                            if (exam.status.isNotBlank()) add(exam.status)
                        }.joinToString(" • ")
                        if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun rememberAcademicBundle(courseId: String, online: Boolean): NativeCpsAcademicBundle? {
    val context = LocalContext.current
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    LaunchedEffect(courseId, online) {
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, online)
    }
    return bundles[courseId]
}

@Composable
private fun AcademicDashboardTile(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = AcademicCard,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(icon, null, Modifier.padding(12.dp).size(24.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
private fun AcademicBack(nav: NavHostController, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun AcademicSection(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
}

@Composable
private fun AcademicChip(text: String) {
    Surface(shape = AcademicPill, color = MaterialTheme.colorScheme.surface.copy(alpha = .6f)) {
        Text(text, Modifier.padding(horizontal = 9.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AcademicStatusChip(text: String) {
    Surface(shape = AcademicPill, color = MaterialTheme.colorScheme.errorContainer) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun AcademicMessage(text: String) {
    Card(shape = AcademicSmall, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(text, Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun NativeCpsAcademicLive.isRunningLive(): Boolean = status.lowercase(Locale.getDefault()) in setOf("live", "running", "ongoing", "started", "live now")

private fun formatTimestamp(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val h = safe / 3600
    val m = (safe % 3600) / 60
    val s = safe % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

private fun parseAcademicTime(value: String): Long? {
    val raw = value.trim()
    if (raw.isBlank()) return null
    raw.toLongOrNull()?.let { return if (it < 10_000_000_000L) it * 1000L else it }
    return runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.LocalDateTime.parse(raw).atZone(DhakaZone).toInstant().toEpochMilli() }.getOrNull()
}

private fun parseAcademicDate(value: String): LocalDate? {
    val millis = parseAcademicTime(value)
    if (millis != null) return Instant.ofEpochMilli(millis).atZone(DhakaZone).toLocalDate()
    val raw = value.trim()
    if (raw.isBlank()) return null
    return try { LocalDate.parse(raw.take(10)) } catch (_: DateTimeParseException) { null }
}

private fun formatAcademicDateTime(value: String): String {
    val millis = parseAcademicTime(value) ?: return value
    return DateTimeFormatter.ofPattern("dd MMM • h:mm a").format(Instant.ofEpochMilli(millis).atZone(DhakaZone))
}

private fun cleanAcademicText(value: String): String = value
    .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
    .replace(Regex("<[^>]+>"), "")
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .trim()
