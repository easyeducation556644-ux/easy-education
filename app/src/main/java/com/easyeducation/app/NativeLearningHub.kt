package com.easyeducation.app

import android.annotation.SuppressLint
import android.webkit.WebSettings
import android.webkit.WebView
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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val HubCardShape = RoundedCornerShape(24.dp)
private val HubRowShape = RoundedCornerShape(17.dp)

private data class HubPlatform(
    val title: String,
    val subtitle: String,
    val route: String,
)

private data class UdvashLiveUiState(
    val data: NativeUdvashLiveSnapshot? = null,
    val refreshing: Boolean = true,
    val error: String = "",
)

private fun manualEasyEducationCourses(state: NativeUiState): List<NativeCourse> = state.courses.filter { course ->
    !course.id.startsWith("cps:") &&
        !course.id.startsWith("edgecourse:") &&
        course.courseFormat != "edgecourse"
}

@Composable
fun NativePlatformsHomeCard(nav: NavHostController, state: NativeUiState) {
    val manualCount = manualEasyEducationCourses(state).size
    val platforms = listOf(
        HubPlatform("Easy Education manual uploaded courses", "$manualCount available in My Courses", "manual-courses"),
        HubPlatform("CPS", "Courses, live classes, exams and resources", "cps"),
        HubPlatform("EdgeCourse", "Course catalog and class resources", "edgecourse"),
        HubPlatform("Udvash", "Structured courses from your Udvash access", "udvash"),
        HubPlatform("iEducation", "Live course catalog", "provider/ieducation"),
        HubPlatform("Medilogy", "Live course catalog", "provider/medilogy"),
        HubPlatform("Bondi Pathshala", "Subjects, chapters and classes", "provider/bondipathshala"),
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = HubCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    Icon(Icons.Default.School, null, Modifier.padding(10.dp).size(24.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Platforms", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Everything is grouped here — no more separate home cards", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            platforms.forEachIndexed { index, platform ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { nav.navigate(platform.route) }.padding(vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(platform.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(platform.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.Default.ArrowForward, "Open ${platform.title}", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
fun NativeManualCoursesScreen(nav: NavHostController, state: NativeUiState) {
    val courses = manualEasyEducationCourses(state)
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { HubHeader(nav, "Easy Education", "Manual uploaded courses") }
        if (courses.isEmpty()) {
            item { HubMessage("No Easy Education manual course is available for this account yet.") }
        } else {
            items(courses, key = { it.id }) { course ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { nav.navigate("course/${course.id}") },
                    shape = HubRowShape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                            Icon(Icons.Default.School, null, Modifier.padding(9.dp).size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(course.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (course.description.isNotBlank()) Text(course.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(Icons.Default.ArrowForward, null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

private fun cpsRunningCount(state: NativeUiState): Int = state.cpsLiveHighlights.count { it.status.isRunningStatus() }
private fun cpsUpcomingCount(state: NativeUiState): Int = state.cpsLiveHighlights.count { !it.status.isRunningStatus() }
private fun String.isRunningStatus(): Boolean = lowercase() in setOf("live", "running", "ongoing", "started", "live now")

@Composable
fun NativeLiveClassesHomeCard(nav: NavHostController, state: NativeUiState) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var liveState by remember { mutableStateOf(UdvashLiveUiState()) }

    LaunchedEffect(Unit) {
        val cached = withContext(Dispatchers.IO) { repository.cachedLiveClasses() }
        liveState = UdvashLiveUiState(data = cached, refreshing = true)
        runCatching { withContext(Dispatchers.IO) { repository.liveClasses() } }
            .onSuccess { liveState = UdvashLiveUiState(data = it, refreshing = false) }
            .onFailure { error -> liveState = liveState.copy(refreshing = false, error = error.message.orEmpty()) }
    }

    val running = cpsRunningCount(state) + (liveState.data?.totalLiveClass ?: 0)
    val upcoming = cpsUpcomingCount(state) + (liveState.data?.totalUpcomingClass ?: 0)
    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("live-classes") },
        shape = HubCardShape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .10f)) {
                Icon(Icons.Default.VideoLibrary, null, Modifier.padding(10.dp).size(25.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Live classes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubCountPill("$running running", running > 0)
                    HubCountPill("$upcoming upcoming", false)
                }
                Text("Open to choose a platform", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .74f))
            }
            if (liveState.refreshing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Icon(Icons.Default.ArrowForward, "Open live classes")
        }
    }
}

@Composable
private fun HubCountPill(label: String, active: Boolean) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (active) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surface.copy(alpha = .62f),
    ) {
        Text(
            label,
            Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = if (active) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
fun NativeLivePlatformsScreen(nav: NavHostController, state: NativeUiState) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    var reload by remember { mutableIntStateOf(0) }
    var liveState by remember { mutableStateOf(UdvashLiveUiState()) }

    LaunchedEffect(reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedLiveClasses() }
        liveState = UdvashLiveUiState(data = cached, refreshing = true)
        runCatching { withContext(Dispatchers.IO) { repository.liveClasses() } }
            .onSuccess { liveState = UdvashLiveUiState(data = it, refreshing = false) }
            .onFailure { error -> liveState = liveState.copy(refreshing = false, error = error.message.orEmpty()) }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { HubHeader(nav, "Live classes", "Choose a platform") }
        item {
            LivePlatformCard(
                title = "Udvash",
                running = liveState.data?.totalLiveClass ?: 0,
                upcoming = liveState.data?.totalUpcomingClass ?: 0,
                refreshing = liveState.refreshing,
                onClick = { nav.navigate("live-classes/udvash") },
            )
        }
        item {
            LivePlatformCard(
                title = "CPS",
                running = cpsRunningCount(state),
                upcoming = cpsUpcomingCount(state),
                refreshing = false,
                onClick = { nav.navigate("live-classes/cps") },
            )
        }
        if (liveState.error.isNotBlank()) item {
            TextButton(onClick = { reload += 1 }) {
                Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
                Spacer(Modifier.width(7.dp))
                Text("Refresh Udvash live data")
            }
        }
        item {
            Text(
                "Easy Education manual courses are intentionally not listed here because Easy Education does not host live classes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun LivePlatformCard(title: String, running: Int, upcoming: Int, refreshing: Boolean, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = HubRowShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.fillMaxWidth().padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Icon(Icons.Default.VideoLibrary, null, Modifier.padding(9.dp).size(22.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    HubCountPill("$running running", running > 0)
                    HubCountPill("$upcoming upcoming", false)
                }
            }
            if (refreshing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Icon(Icons.Default.ArrowForward, null)
        }
    }
}

@Composable
fun NativeCpsGlobalLiveScreen(nav: NavHostController, state: NativeUiState) {
    val context = LocalContext.current
    val classes = state.cpsLiveHighlights.sortedBy { it.startTime }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { HubHeader(nav, "CPS live classes", "${cpsRunningCount(state)} running • ${cpsUpcomingCount(state)} upcoming") }
        if (classes.isEmpty()) item { HubMessage("No CPS live or upcoming class is available right now.") }
        else items(classes, key = { it.id }) { live ->
            Card(
                modifier = Modifier.fillMaxWidth().clickable(enabled = live.url.isNotBlank() && live.hasAccess) {
                    NativeCpsLivePlayerActivity.openLive(context, live.title, live.url, live.id)
                },
                shape = HubRowShape,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        HubCountPill(if (live.status.isRunningStatus()) "RUNNING" else "UPCOMING", live.status.isRunningStatus())
                        Spacer(Modifier.width(8.dp))
                        Text(live.platform.ifBlank { "CPS" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(live.title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
                    if (live.courseTitle.isNotBlank()) Text(live.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (live.startTime.isNotBlank()) Text(live.startTime, style = MaterialTheme.typography.bodySmall)
                    if (live.url.isNotBlank() && live.hasAccess) Text("Tap to join", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
fun NativeUdvashLiveClassesScreen(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember { NativeUdvashRepository(context) }
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var liveState by remember { mutableStateOf(UdvashLiveUiState()) }
    var joiningRoutineId by remember { mutableIntStateOf(0) }
    var joinError by remember { mutableStateOf("") }

    LaunchedEffect(reload) {
        val cached = withContext(Dispatchers.IO) { repository.cachedLiveClasses() }
        liveState = UdvashLiveUiState(data = cached, refreshing = true)
        runCatching { withContext(Dispatchers.IO) { repository.liveClasses() } }
            .onSuccess { liveState = UdvashLiveUiState(data = it, refreshing = false) }
            .onFailure { error -> liveState = liveState.copy(refreshing = false, error = error.message.orEmpty()) }
    }

    val snapshot = liveState.data
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item {
            HubHeader(
                nav,
                "Udvash live classes",
                "${snapshot?.totalLiveClass ?: 0} running • ${snapshot?.totalUpcomingClass ?: 0} upcoming",
            )
        }
        if (snapshot == null && liveState.refreshing) item { HubLoading("Loading live classes…") }
        else if (snapshot == null && liveState.error.isNotBlank()) item { HubMessage(liveState.error) }
        else if (snapshot?.classes.orEmpty().isEmpty()) item { HubMessage("No Udvash live or upcoming class is available right now.") }
        else items(snapshot?.classes.orEmpty(), key = { "${it.sourceAccountId}:${it.routineId}" }) { live ->
            UdvashLiveClassCard(
                live = live,
                joinBeforeMinutes = snapshot?.joinButtonBeforeMinutes ?: 10,
                joining = joiningRoutineId == live.routineId,
                onJoin = {
                    joinError = ""
                    joiningRoutineId = live.routineId
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                repository.joinLiveClass(
                                    sourceAccountId = live.sourceAccountId,
                                    courseId = live.courseId,
                                    routineId = live.routineId,
                                    studentProgramId = live.studentProgramId,
                                )
                            }
                        }.onSuccess { result ->
                            joiningRoutineId = 0
                            if (result.contentUrl.isNotBlank()) {
                                NativeCpsLivePlayerActivity.openLive(context, live.lectureName, result.contentUrl, "udvash:${live.routineId}")
                            } else {
                                joinError = "Udvash did not return a join URL."
                            }
                        }.onFailure { error ->
                            joiningRoutineId = 0
                            joinError = error.message ?: "Could not join this live class."
                        }
                    }
                },
            )
        }
        if (joinError.isNotBlank()) item { HubMessage(joinError) }
        if (liveState.refreshing && snapshot != null) item { HubLoading("Checking for new live classes…") }
        if (!liveState.refreshing) item {
            TextButton(onClick = { reload += 1 }) {
                Icon(Icons.Default.Refresh, null, Modifier.size(17.dp))
                Spacer(Modifier.width(7.dp))
                Text("Refresh live classes")
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun UdvashLiveClassCard(
    live: NativeUdvashLiveClass,
    joinBeforeMinutes: Int,
    joining: Boolean,
    onJoin: () -> Unit,
) {
    val canJoin = canJoinUdvashLive(live, joinBeforeMinutes)
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth().padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                HubCountPill(if (live.isLive) "LIVE NOW" else "UPCOMING", live.isLive)
                Spacer(Modifier.width(8.dp))
                if (live.subjectName.isNotBlank()) Text(live.subjectName, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            Text(live.lectureName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
            if (live.courseName.isNotBlank()) Text(live.courseName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (live.programSessionName.isNotBlank()) Text(live.programSessionName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val timeLabel = liveTimeLabel(live)
            if (timeLabel.isNotBlank()) Text(timeLabel, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            if (live.syllabusHtml.isNotBlank()) {
                Text("Syllabus", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                UdvashSyllabusHtml(live.syllabusHtml)
            }
            if (canJoin) {
                Button(onClick = onJoin, enabled = !joining, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) {
                    if (joining) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Joining…")
                    } else {
                        Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(7.dp))
                        Text(if (live.isLive) "Join live class" else "Join class")
                    }
                }
            } else {
                Text("Join opens $joinBeforeMinutes minutes before class", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private fun canJoinUdvashLive(live: NativeUdvashLiveClass, joinBeforeMinutes: Int): Boolean {
    if (live.isServiceBlocked) return false
    if (live.isLive) return true
    val start = parseProviderTime(live.startDateTime) ?: return false
    val end = parseProviderTime(live.endDateTime)
    val now = System.currentTimeMillis()
    val opens = start - joinBeforeMinutes.coerceAtLeast(0) * 60_000L
    return now >= opens && (end == null || now <= end)
}

private fun liveTimeLabel(live: NativeUdvashLiveClass): String {
    val start = parseProviderTime(live.startDateTime) ?: return live.startDateTime
    val formatter = DateTimeFormatter.ofPattern("EEE, d MMM • h:mm a")
    val startText = java.time.Instant.ofEpochMilli(start).atZone(ZoneId.systemDefault()).format(formatter)
    val end = parseProviderTime(live.endDateTime)
    if (end == null) return startText
    val endText = java.time.Instant.ofEpochMilli(end).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("h:mm a"))
    return "$startText – $endText"
}

private fun parseProviderTime(value: String): Long? = runCatching {
    LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
}.getOrNull()

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun UdvashSyllabusHtml(html: String) {
    val textColor = MaterialTheme.colorScheme.onSurface.toArgb()
    val background = MaterialTheme.colorScheme.surfaceVariant.toArgb()
    val cssText = String.format("#%06X", 0xFFFFFF and textColor)
    val cssBg = String.format("#%06X", 0xFFFFFF and background)
    val wrapped = remember(html, cssText, cssBg) {
        """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
        <style>
          html,body{margin:0;padding:0;background:$cssBg;color:$cssText;font-family:sans-serif;line-height:1.55}
          body{padding:12px;box-sizing:border-box;font-size:14px}
          *{max-width:100%;box-sizing:border-box}
          p{margin:4px 0} div{max-width:100%} img{height:auto}
          .exam-syllabus-clean{width:100%!important;border:0!important;padding:0!important;color:$cssText!important}
          .exam-syllabus-clean p{color:$cssText!important;text-align:left!important}
        </style></head><body>$html</body></html>
        """.trimIndent()
    }
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(165.dp),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(background)
                settings.javaScriptEnabled = false
                settings.domStorageEnabled = false
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                isVerticalScrollBarEnabled = true
                isHorizontalScrollBarEnabled = false
            }
        },
        update = { view ->
            view.setBackgroundColor(background)
            view.loadDataWithBaseURL("https://student-api.udvash-unmesh.com/", wrapped, "text/html", "utf-8", null)
        },
    )
}

@Composable
private fun HubHeader(nav: NavHostController, title: String, subtitle: String) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun HubMessage(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = HubRowShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Text(message, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HubLoading(label: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(9.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
