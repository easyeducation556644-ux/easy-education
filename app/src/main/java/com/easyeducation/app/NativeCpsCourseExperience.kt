package com.easyeducation.app

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
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Topic
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import java.util.Locale

private enum class CpsCoursePage { HOME, LIVE, LIVE_GROUP, RESOURCES, ROUTINE, TOPICS, EXAMS }
private val CpsExperienceCard = RoundedCornerShape(20.dp)
private val CpsExperienceSmall = RoundedCornerShape(14.dp)
private val CpsExperiencePill = RoundedCornerShape(999.dp)
private val CpsDhakaZone = ZoneId.of("Asia/Dhaka")

@Composable
fun NativeCpsCourseExperience(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val academicMap by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    var pageName by rememberSaveable(courseId) { mutableStateOf(CpsCoursePage.HOME.name) }
    var liveGroupId by rememberSaveable(courseId) { mutableStateOf("") }
    val page = runCatching { CpsCoursePage.valueOf(pageName) }.getOrDefault(CpsCoursePage.HOME)

    LaunchedEffect(courseId, state.online) {
        viewModel.loadCourse(courseId)
        NativeCpsAcademicStore.seed(context, courseId)
        NativeCpsAcademicStore.refresh(context, courseId, state.online)
    }

    BackHandler(enabled = page != CpsCoursePage.HOME) {
        pageName = if (page == CpsCoursePage.LIVE_GROUP) CpsCoursePage.LIVE.name else CpsCoursePage.HOME.name
    }

    val academic = academicMap[courseId]
    when (page) {
        CpsCoursePage.HOME -> CpsExperienceHome(nav, viewModel, state, courseId, academic) { target -> pageName = target.name }
        CpsCoursePage.LIVE -> CpsExperienceLiveGroups(academic, onBack = { pageName = CpsCoursePage.HOME.name }) { group ->
            liveGroupId = group
            pageName = CpsCoursePage.LIVE_GROUP.name
        }
        CpsCoursePage.LIVE_GROUP -> CpsExperienceLiveGroup(academic, liveGroupId, onBack = { pageName = CpsCoursePage.LIVE.name })
        CpsCoursePage.RESOURCES -> CpsExperienceResources(academic, onBack = { pageName = CpsCoursePage.HOME.name })
        CpsCoursePage.ROUTINE -> CpsExperienceRoutine(academic, onBack = { pageName = CpsCoursePage.HOME.name })
        CpsCoursePage.TOPICS -> CpsExperienceTopics(state, courseId, academic, onBack = { pageName = CpsCoursePage.HOME.name })
        CpsCoursePage.EXAMS -> CpsExperienceExams(nav, state, courseId, onBack = { pageName = CpsCoursePage.HOME.name })
    }
}

@Composable
private fun CpsExperienceHome(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    academic: NativeCpsAcademicBundle?,
    onPage: (CpsCoursePage) -> Unit,
) {
    val entry = state.cpsCourses.firstOrNull { it.course.id == courseId }
    val course = state.courseContent[courseId]?.course ?: entry?.course
    val access = academic?.hasAccess ?: viewModel.hasCpsAccess(courseId)
    if (course == null) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CpsExperienceBack(nav, "CPS Course")
            repeat(5) { Box(Modifier.fillMaxWidth().height(72.dp).background(MaterialTheme.colorScheme.surfaceVariant, CpsExperienceSmall)) }
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(nav, course.title) }
        item {
            Card(shape = CpsExperienceCard, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) AsyncImage(course.thumbnailUrl, course.title, Modifier.fillMaxWidth().aspectRatio(16f / 7f), contentScale = ContentScale.Crop)
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            CpsExperienceChip("CPS")
                            CpsExperienceChip("LIVE + INSTANT")
                        }
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
        item { CpsExperienceTile("Live Classes", "Part-wise live, upcoming and recorded classes", Icons.Default.LiveTv) { onPage(CpsCoursePage.LIVE) } }
        item { CpsExperienceTile("Exams", "Timed exams, answers and saved results", Icons.Default.Quiz) { onPage(CpsCoursePage.EXAMS) } }
        item { CpsExperienceTile("Slides & Practice Sheet", "Chapter-wise notes, slides and practice resources", Icons.Default.Description) { onPage(CpsCoursePage.RESOURCES) } }
        item { CpsExperienceTile("Routine", "Calendar for live classes, exams and routine", Icons.Default.CalendarMonth) { onPage(CpsCoursePage.ROUTINE) } }
        item { CpsExperienceTile("All Topics", "Chapter-wise topics with exact video timestamps", Icons.Default.Topic) { onPage(CpsCoursePage.TOPICS) } }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun CpsExperienceLiveGroups(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit, onGroup: (String) -> Unit) {
    val groups = bundle?.liveClasses.orEmpty().groupBy { it.playlistId.ifBlank { it.playlistTitle } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, "Live Classes") }
        if (groups.isEmpty()) item { CpsExperienceMessage("No live class group is available yet.") }
        groups.forEach { (groupId, classes) ->
            val title = classes.firstOrNull()?.playlistTitle?.ifBlank { "Live Classes" } ?: "Live Classes"
            val running = classes.any { it.cpsRunning() }
            item(key = "experience-group-$groupId") {
                Card(Modifier.fillMaxWidth().clickable { onGroup(groupId) }, shape = CpsExperienceCard, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(14.dp), color = if (running) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
                            Icon(Icons.Default.LiveTv, null, Modifier.padding(11.dp).size(23.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (running) CpsExperienceStatus("LIVE")
                            }
                            Text("${classes.size} class${if (classes.size == 1) "" else "es"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
    }
}

@Composable
private fun CpsExperienceLiveGroup(bundle: NativeCpsAcademicBundle?, groupId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val list = bundle?.liveClasses.orEmpty().filter { it.playlistId == groupId || (it.playlistId.isBlank() && it.playlistTitle == groupId) }
        .sortedByDescending { cpsTimeMillis(it.startTime) ?: 0L }
    val title = list.firstOrNull()?.playlistTitle ?: "Live Classes"
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, title) }
        if (list.isEmpty()) item { CpsExperienceMessage("No class is available in this part yet.") }
        items(list, key = { "experience-live-${it.id}" }) { live ->
            Card(shape = CpsExperienceSmall, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Surface(shape = CircleShape, color = if (live.cpsRunning()) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
                            Icon(Icons.Default.LiveTv, null, Modifier.padding(9.dp).size(20.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(live.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val meta = listOf(cpsDateTime(live.startTime), live.status.uppercase(Locale.getDefault()), live.platform).filter { it.isNotBlank() }.joinToString(" • ")
                            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (live.cpsRunning() && live.hasAccess && live.url.isNotBlank()) {
                        Button(onClick = { NativeCpsLivePlayerActivity.openLive(context, live.title, live.url, live.id) }, modifier = Modifier.fillMaxWidth(), shape = CpsExperiencePill) {
                            Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text("Watch Live")
                        }
                    } else if (live.status.lowercase(Locale.getDefault()) in setOf("upcoming", "scheduled")) {
                        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth(), shape = CpsExperiencePill) {
                            Icon(Icons.Default.Schedule, null); Spacer(Modifier.width(6.dp)); Text("Upcoming")
                        }
                    }
                    if (live.recordings.isNotEmpty()) {
                        Text("Recordings", fontWeight = FontWeight.SemiBold)
                        live.recordings.forEach { recording ->
                            OutlinedButton(
                                onClick = { NativeCpsLivePlayerActivity.openRecording(context, recording.title.ifBlank { live.title }, recording.url, "${live.id}:${recording.id}") },
                                enabled = live.hasAccess && recording.url.isNotBlank(),
                                modifier = Modifier.fillMaxWidth(),
                                shape = CpsExperiencePill,
                            ) {
                                Icon(if (recording.url.isNotBlank()) Icons.Default.PlayArrow else Icons.Default.Lock, null)
                                Spacer(Modifier.width(6.dp)); Text(recording.title)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CpsExperienceResources(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val context = LocalContext.current
    val grouped = bundle?.resources.orEmpty().groupBy { it.chapter.ifBlank { "Resources" } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, "Slides & Practice Sheet") }
        if (grouped.isEmpty()) item { CpsExperienceMessage("No slides or practice resources are available yet.") }
        grouped.forEach { (chapter, resources) ->
            item(key = "experience-resource-title-$chapter") { CpsExperienceSection(chapter) }
            items(resources, key = { it.id }) { resource ->
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = !resource.locked && resource.url.isNotBlank()) { NativeResourceViewerActivity.open(context, resource.title, resource.url) },
                    shape = CpsExperienceSmall,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) { Icon(Icons.Default.Description, null, Modifier.padding(9.dp).size(21.dp)) }
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
    }
}

@Composable
private fun CpsExperienceRoutine(bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    var monthText by rememberSaveable { mutableStateOf(YearMonth.now(CpsDhakaZone).toString()) }
    val month = runCatching { YearMonth.parse(monthText) }.getOrElse { YearMonth.now(CpsDhakaZone) }
    val events = bundle?.calendarEvents.orEmpty()
    val byDate = events.groupBy { cpsDate(it.startTime) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, "Routine") }
        item {
            Card(shape = CpsExperienceCard, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { monthText = month.minusMonths(1).toString() }) { Text("‹", style = MaterialTheme.typography.headlineSmall) }
                        Text(month.format(DateTimeFormatter.ofPattern("MMMM yyyy")), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        IconButton(onClick = { monthText = month.plusMonths(1).toString() }) { Text("›", style = MaterialTheme.typography.headlineSmall) }
                    }
                    Row(Modifier.fillMaxWidth()) { listOf("Su","Mo","Tu","We","Th","Fr","Sa").forEach { Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
                    val offset = month.atDay(1).dayOfWeek.value % 7
                    val cells = buildList<LocalDate?> {
                        repeat(offset) { add(null) }
                        for (day in 1..month.lengthOfMonth()) add(month.atDay(day))
                        while (size % 7 != 0) add(null)
                    }
                    cells.chunked(7).forEach { week ->
                        Row(Modifier.fillMaxWidth()) {
                            week.forEach { date ->
                                val marked = date != null && byDate[date].orEmpty().isNotEmpty()
                                Box(Modifier.weight(1f).height(44.dp), contentAlignment = Alignment.Center) {
                                    if (date != null) Surface(shape = CircleShape, color = if (marked) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface) {
                                        Text(date.dayOfMonth.toString(), Modifier.padding(9.dp), fontWeight = if (marked) FontWeight.ExtraBold else FontWeight.Normal)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        val monthEvents = events.filter { cpsDate(it.startTime)?.let { date -> YearMonth.from(date) == month } == true }.sortedBy { cpsTimeMillis(it.startTime) ?: Long.MAX_VALUE }
        if (monthEvents.isNotEmpty()) {
            item { CpsExperienceSection("Schedule") }
            items(monthEvents, key = { it.id }) { event ->
                Card(shape = CpsExperienceSmall, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (event.kind == "live") Icons.Default.LiveTv else Icons.Default.Event, null)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) { Text(event.title, fontWeight = FontWeight.SemiBold); Text(cpsDateTime(event.startTime), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
        bundle?.routine?.takeIf { it.isNotBlank() }?.let { routine -> item { CpsExperienceSection("Course Routine") }; item { CpsExperienceMessage(cpsCleanText(routine)) } }
    }
}

@Composable
private fun CpsExperienceTopics(state: NativeUiState, courseId: String, bundle: NativeCpsAcademicBundle?, onBack: () -> Unit) {
    val context = LocalContext.current
    val grouped = bundle?.topics.orEmpty().groupBy { it.chapter.ifBlank { "Topics" } }
    val classes = state.courseContent[courseId]?.classes.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, "All Topics") }
        if (grouped.isEmpty()) item { CpsExperienceMessage("No timestamped topics are available yet.") }
        grouped.forEach { (chapter, topics) ->
            item(key = "experience-topic-title-$chapter") { CpsExperienceSection(chapter) }
            items(topics, key = { it.id }) { topic ->
                val classItem = classes.firstOrNull { it.id == topic.classId }
                val playable = topic.canOpen && classItem?.sourceUrl?.isNotBlank() == true
                Card(
                    Modifier.fillMaxWidth().clickable(enabled = playable) {
                        val source = classItem?.sourceUrl.orEmpty()
                        if (source.isBlank()) Toast.makeText(context, "Pull to refresh and retry.", Toast.LENGTH_SHORT).show()
                        else NativeCpsLivePlayerActivity.openRecording(context, topic.title, source, topic.classId, topic.videoTimestamp.toLong() * 1000L)
                    },
                    shape = CpsExperienceSmall,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = CpsExperiencePill, color = MaterialTheme.colorScheme.secondaryContainer) { Text(cpsTimestamp(topic.videoTimestamp), Modifier.padding(horizontal = 9.dp, vertical = 5.dp), fontWeight = FontWeight.Bold) }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) { Text(topic.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis); if (topic.classTitle.isNotBlank()) Text(topic.classTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
                        Icon(if (playable) Icons.Default.PlayArrow else Icons.Default.Lock, null)
                    }
                }
            }
        }
    }
}

@Composable
private fun CpsExperienceExams(nav: NavHostController, state: NativeUiState, courseId: String, onBack: () -> Unit) {
    val exams = state.cpsCourseExtras[courseId]?.exams.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Spacer(Modifier.height(4.dp)); CpsExperienceBack(onBack, "Exams") }
        if (exams.isEmpty()) item { CpsExperienceMessage("No exam is available for this course yet.") }
        items(exams, key = { it.id }) { exam ->
            Card(
                Modifier.fillMaxWidth().clickable { nav.navigate("cps-exam/${Uri.encode(courseId)}/${Uri.encode(exam.id)}") },
                shape = CpsExperienceSmall,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) { Icon(Icons.Default.Quiz, null, Modifier.padding(9.dp).size(21.dp)) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(exam.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(buildList { if (exam.duration > 0) add("${exam.duration} min"); if (exam.questionsCount > 0) add("${exam.questionsCount} questions"); if (exam.status.isNotBlank()) add(exam.status) }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Default.ArrowForward, null)
                }
            }
        }
    }
}

@Composable
private fun CpsExperienceTile(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick), shape = CpsExperienceCard, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(12.dp).size(24.dp)) }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable private fun CpsExperienceBack(nav: NavHostController, title: String) = CpsExperienceBack({ nav.popBackStack() }, title)
@Composable private fun CpsExperienceBack(onBack: () -> Unit, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) }
}
@Composable private fun CpsExperienceSection(title: String) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold) }
@Composable private fun CpsExperienceChip(text: String) { Surface(shape = CpsExperiencePill, color = MaterialTheme.colorScheme.primaryContainer) { Text(text, Modifier.padding(horizontal = 9.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
@Composable private fun CpsExperienceStatus(text: String) { Surface(shape = CpsExperiencePill, color = MaterialTheme.colorScheme.errorContainer) { Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold) } }
@Composable private fun CpsExperienceMessage(text: String) { Card(shape = CpsExperienceSmall, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) { Text(text, Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) } }

private fun NativeCpsAcademicLive.cpsRunning() = status.lowercase(Locale.getDefault()) in setOf("live", "running", "ongoing", "started", "live now")
private fun cpsTimestamp(seconds: Int): String { val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = safe % 3600 / 60; val s = safe % 60; return if (h > 0) "%d:%02d:%02d".format(h,m,s) else "%d:%02d".format(m,s) }
private fun cpsTimeMillis(value: String): Long? { val raw = value.trim(); if (raw.isBlank()) return null; raw.toLongOrNull()?.let { return if (it < 10_000_000_000L) it * 1000L else it }; return runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull() ?: runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull() ?: runCatching { java.time.LocalDateTime.parse(raw).atZone(CpsDhakaZone).toInstant().toEpochMilli() }.getOrNull() }
private fun cpsDate(value: String): LocalDate? { cpsTimeMillis(value)?.let { return Instant.ofEpochMilli(it).atZone(CpsDhakaZone).toLocalDate() }; return runCatching { LocalDate.parse(value.trim().take(10)) }.getOrNull() }
private fun cpsDateTime(value: String): String { val ms = cpsTimeMillis(value) ?: return value; return DateTimeFormatter.ofPattern("dd MMM • h:mm a").format(Instant.ofEpochMilli(ms).atZone(CpsDhakaZone)) }
private fun cpsCleanText(value: String) = value.replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n").replace(Regex("<[^>]+>"), "").replace("&nbsp;", " ").replace("&amp;", "&").trim()
