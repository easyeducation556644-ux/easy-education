package com.easyeducation.app

import android.content.Context
import android.net.Uri
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val CpsRadius = RoundedCornerShape(22.dp)
private val CpsSmallRadius = RoundedCornerShape(14.dp)
private val CpsPill = RoundedCornerShape(999.dp)

@Composable
fun NativeCpsHomeBlock(nav: NavHostController, state: NativeUiState) {
    val now = System.currentTimeMillis()
    val unlocked = state.cpsCourses.count { entry ->
        entry.hasAccess && (entry.accessExpiresAtMs == 0L || entry.accessExpiresAtMs > now)
    }
    val live = state.cpsLiveHighlights.firstOrNull()
    val liveNow = live?.status?.equals("live", ignoreCase = true) == true
    val surface = MaterialTheme.colorScheme.primaryContainer
    val onSurface = MaterialTheme.colorScheme.onPrimaryContainer

    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("cps") },
        shape = CpsRadius,
        colors = CardDefaults.cardColors(containerColor = surface, contentColor = onSurface),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(shape = RoundedCornerShape(16.dp), color = onSurface.copy(alpha = 0.10f)) {
                Icon(
                    Icons.Default.School,
                    contentDescription = null,
                    modifier = Modifier.padding(11.dp).size(27.dp),
                    tint = onSurface,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("CPS", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(8.dp))
                    CpsPillText("LIVE + INSTANT", onSurface.copy(alpha = 0.10f), onSurface)
                }
                Text(
                    "${state.cpsCourses.size} courses • $unlocked unlocked",
                    style = MaterialTheme.typography.bodySmall,
                    color = onSurface.copy(alpha = 0.76f),
                )
                if (live != null) {
                    Text(
                        buildString {
                            if (liveNow) append("LIVE NOW • ") else append("TODAY • ")
                            if (live.courseTitle.isNotBlank()) append("${live.courseTitle} • ")
                            append(live.title)
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    Text(
                        "Browse classes, live schedule, exams and routine",
                        style = MaterialTheme.typography.labelMedium,
                        color = onSurface.copy(alpha = 0.72f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Surface(shape = CircleShape, color = onSurface.copy(alpha = 0.10f)) {
                Icon(Icons.Default.ArrowForward, "Open CPS", Modifier.padding(9.dp).size(20.dp), tint = onSurface)
            }
        }
    }
}

@Composable
fun NativeCpsCatalogScreen(nav: NavHostController, state: NativeUiState) {
    val now = System.currentTimeMillis()
    val unlocked = state.cpsCourses.count { it.hasAccess && (it.accessExpiresAtMs == 0L || it.accessExpiresAtMs > now) }
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); CpsBack(nav, "CPS") }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = CpsRadius,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Box(
                    Modifier.fillMaxWidth().background(
                        Brush.linearGradient(
                            listOf(
                                MaterialTheme.colorScheme.primaryContainer,
                                MaterialTheme.colorScheme.secondaryContainer,
                            ),
                        ),
                    ),
                ) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        CpsPillText(
                            "CPS LEARNING SPACE",
                            MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.10f),
                            MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Text(
                            "Live class, instant class, exams — together.",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Text(
                            "You can explore every available course and class title. Playable content unlocks only after Easy Education admin access is active.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.76f),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CpsPillText("${state.cpsCourses.size} courses", MaterialTheme.colorScheme.surface.copy(alpha = 0.45f), MaterialTheme.colorScheme.onPrimaryContainer)
                            CpsPillText("$unlocked unlocked", MaterialTheme.colorScheme.surface.copy(alpha = 0.45f), MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }
        }
        if (state.cpsLiveHighlights.isNotEmpty()) {
            item { CpsSectionTitle("Today / Live now") }
            items(state.cpsLiveHighlights, key = { "hub-live-${it.courseId}-${it.id}" }) { live ->
                CpsLiveRow(
                    item = live,
                    canJoin = state.online && live.hasAccess && live.url.isNotBlank(),
                    onOpenCourse = {
                        val target = live.courseId.takeIf { it.startsWith("cps:") }
                        if (target != null) nav.navigate("course/${Uri.encode(target)}")
                    },
                )
            }
        }
        item { CpsSectionTitle("All CPS courses") }
        if (state.cpsCourses.isEmpty()) {
            item {
                CpsMessageCard(
                    if (state.online) "CPS catalog is not available yet. Sync learning data and retry."
                    else "No CPS catalog is cached on this device yet. Connect once to load it.",
                )
            }
        } else {
            items(state.cpsCourses, key = { it.course.id }) { entry ->
                NativeCpsCatalogCourseCard(entry) {
                    nav.navigate("course/${Uri.encode(entry.course.id)}")
                }
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun NativeCpsCatalogCourseCard(entry: NativeCpsCourseEntry, onClick: () -> Unit) {
    val now = System.currentTimeMillis()
    val unlocked = entry.hasAccess && (entry.accessExpiresAtMs == 0L || entry.accessExpiresAtMs > now)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = CpsRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column {
            if (entry.course.thumbnailUrl.isNotBlank()) {
                AsyncImage(
                    model = entry.course.thumbnailUrl,
                    contentDescription = entry.course.title,
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f),
                    contentScale = ContentScale.Crop,
                )
            }
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    CpsPillText("CPS", MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
                    CpsPillText("WITH LIVE + INSTANT", MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
                }
                Text(entry.course.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (entry.course.description.isNotBlank()) {
                    Text(
                        entry.course.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (unlocked) Icons.Default.CheckCircle else Icons.Default.Lock,
                        contentDescription = null,
                        modifier = Modifier.size(17.dp),
                        tint = if (unlocked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (unlocked) "Access active" else "Preview curriculum • classes locked",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.weight(1f))
                    Text("Open ›", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun NativeCpsCourseScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    LaunchedEffect(courseId, state.online) { viewModel.loadCourse(courseId, force = state.online) }

    val catalogEntry = state.cpsCourses.firstOrNull { it.course.id == courseId }
    val content = state.courseContent[courseId]
    val extras = state.cpsCourseExtras[courseId]
    val course = content?.course ?: catalogEntry?.course
    if (course == null) {
        CpsLoading(nav)
        return
    }

    val access = viewModel.hasCpsAccess(courseId)
    val classes = content?.classes.orEmpty().filterNot { it.isArchived }
    val pastLive = classes.filter { item -> item.subjects.any { it.equals("Past live classes", ignoreCase = true) } }
    val recorded = classes.filterNot { item -> item.subjects.any { it.equals("Past live classes", ignoreCase = true) } }
    val groupedRecorded = recorded.groupBy { it.subjects.firstOrNull().orEmpty().ifBlank { "Instant classes" } }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); CpsBack(nav, course.title) }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = CpsRadius,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) {
                        AsyncImage(
                            model = course.thumbnailUrl,
                            contentDescription = course.title,
                            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f),
                            contentScale = ContentScale.Crop,
                        )
                    }
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            CpsPillText("CPS", MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
                            CpsPillText("LIVE CLASS", MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
                            CpsPillText("INSTANT CLASS", MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
                        }
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        if (course.description.isNotBlank()) {
                            Text(course.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }

        item {
            val container = if (access) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
            val foreground = if (access) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
            Card(colors = CardDefaults.cardColors(containerColor = container, contentColor = foreground), shape = CpsSmallRadius) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = CircleShape, color = foreground.copy(alpha = 0.10f)) {
                        Icon(
                            if (access) Icons.Default.CheckCircle else Icons.Default.Lock,
                            null,
                            Modifier.padding(9.dp).size(20.dp),
                            tint = foreground,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (access) "CPS access active" else "Preview mode", fontWeight = FontWeight.Bold)
                        Text(
                            when {
                                access && extras?.accessExpiresAtMs != null && extras.accessExpiresAtMs > 0L ->
                                    "Available until ${formatCpsDate(extras.accessExpiresAtMs)}"
                                access -> "Live, instant, exam and resources are unlocked while online."
                                !state.online -> "Cached curriculum only • connect to verify access."
                                else -> "You can see the curriculum; video, live links and exams stay locked until admin grants access."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = foreground.copy(alpha = 0.78f),
                        )
                    }
                }
            }
        }

        if (extras?.liveClasses?.isNotEmpty() == true) {
            item { CpsSectionTitle("Live classes") }
            items(extras.liveClasses, key = { "course-live-${it.id}" }) { live ->
                CpsLiveRow(
                    item = live,
                    canJoin = access && state.online && live.url.isNotBlank(),
                    onOpenCourse = null,
                )
            }
        }

        if (groupedRecorded.isNotEmpty()) {
            item { CpsSectionTitle("Instant & recorded classes") }
            groupedRecorded.forEach { (group, groupClasses) ->
                item(key = "cps-group-$group") {
                    Surface(shape = CpsPill, color = MaterialTheme.colorScheme.surfaceVariant) {
                        Text(
                            group,
                            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                items(groupClasses, key = { "cps-class-${it.id}" }) { classItem ->
                    CpsClassRow(
                        context = context,
                        item = classItem,
                        canPlay = access && state.online && classItem.sourceUrl.isNotBlank(),
                        onPlay = {
                            NativeWatchBackdrop.capture(context)
                            nav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(classItem.id)}")
                        },
                    )
                }
            }
        } else if (content != null) {
            item { CpsMessageCard("No instant or recorded classes are available yet.") }
        }

        if (pastLive.isNotEmpty()) {
            item { CpsSectionTitle("Past live classes") }
            items(pastLive, key = { "cps-past-${it.id}" }) { classItem ->
                CpsClassRow(
                    context = context,
                    item = classItem,
                    canPlay = access && state.online && classItem.sourceUrl.isNotBlank(),
                    onPlay = {
                        NativeWatchBackdrop.capture(context)
                        nav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(classItem.id)}")
                    },
                )
            }
        }

        if (extras?.exams?.isNotEmpty() == true) {
            item { CpsSectionTitle("Exams") }
            items(extras.exams, key = { "cps-exam-${it.id}" }) { exam ->
                CpsExamRow(
                    exam = exam,
                    canStart = access && state.online,
                    onStart = { nav.navigate("cps-exam/${Uri.encode(courseId)}/${Uri.encode(exam.id)}") },
                )
            }
        }

        extras?.routines?.takeIf { it.isNotBlank() }?.let { routine ->
            item { CpsSectionTitle("Routine") }
            item { CpsTextCard(Icons.Default.Schedule, cleanCpsText(routine)) }
        }
        extras?.updates?.takeIf { it.isNotBlank() }?.let { updates ->
            item { CpsSectionTitle("Course updates") }
            item { CpsTextCard(Icons.Default.Event, cleanCpsText(updates)) }
        }

        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun CpsLiveRow(item: NativeCpsLiveClass, canJoin: Boolean, onOpenCourse: (() -> Unit)?) {
    val context = LocalContext.current
    val liveNow = item.status.equals("live", ignoreCase = true)
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = CpsSmallRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = if (liveNow) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
            ) {
                Icon(
                    Icons.Default.LiveTv,
                    null,
                    Modifier.padding(10.dp).size(23.dp),
                    tint = if (liveNow) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (item.courseTitle.isNotBlank()) {
                    Text(item.courseTitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val meta = listOf(
                    if (liveNow) "LIVE NOW" else item.status.uppercase(Locale.getDefault()),
                    item.startTime,
                    item.platform,
                ).filter { it.isNotBlank() }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            }
            Spacer(Modifier.width(8.dp))
            when {
                canJoin -> Button(
                    onClick = { NativeResourceViewerActivity.open(context, item.title, item.url) },
                    shape = CpsPill,
                ) { Text("Join") }
                onOpenCourse != null -> TextButton(onClick = onOpenCourse) { Text(if (item.hasAccess) "Open" else "Locked") }
                else -> {
                    Surface(shape = CpsPill, color = MaterialTheme.colorScheme.surfaceVariant) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Lock, null, Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Locked", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CpsClassRow(context: Context, item: NativeClassItem, canPlay: Boolean, onPlay: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = canPlay, onClick = onPlay),
        shape = CpsSmallRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (item.imageUrl.isNotBlank()) {
                AsyncImage(
                    model = item.imageUrl,
                    contentDescription = null,
                    modifier = Modifier.width(104.dp).height(66.dp).clip(RoundedCornerShape(11.dp)),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Box(
                    Modifier.width(104.dp).height(66.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(11.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (canPlay) Icons.Default.PlayArrow else Icons.Default.Lock, null, Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOf(item.teacherName, item.duration).filter { it.isNotBlank() }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.resourceLinks.isNotEmpty() && canPlay) {
                    Text("${item.resourceLinks.size} resource(s)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            Spacer(Modifier.width(6.dp))
            Icon(
                if (canPlay) Icons.Default.PlayArrow else Icons.Default.Lock,
                if (canPlay) "Play" else "Locked",
                tint = if (canPlay) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CpsExamRow(exam: NativeCpsExamSummary, canStart: Boolean, onStart: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = canStart, onClick = onStart),
        shape = CpsSmallRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Icon(Icons.Default.Event, null, Modifier.padding(10.dp).size(23.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(exam.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = buildList {
                    exam.status.takeIf { it.isNotBlank() }?.let(::add)
                    if (exam.duration > 0) add("${exam.duration} min")
                    if (exam.questionsCount > 0) add("${exam.questionsCount} questions")
                }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (canStart) Text("Start ›", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            else Icon(Icons.Default.Lock, "Locked", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CpsTextCard(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = CpsSmallRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.Top) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Icon(icon, null, Modifier.padding(9.dp).size(20.dp))
            }
            Spacer(Modifier.width(11.dp))
            Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun CpsSectionTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
}

@Composable
private fun CpsPillText(label: String, container: androidx.compose.ui.graphics.Color, content: androidx.compose.ui.graphics.Color) {
    Surface(shape = CpsPill, color = container) {
        Text(
            label,
            Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = content,
        )
    }
}

@Composable
private fun CpsMessageCard(message: String) {
    Card(
        Modifier.fillMaxWidth(),
        shape = CpsSmallRadius,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Text(message, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CpsBack(nav: NavHostController, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CpsLoading(nav: NavHostController) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CpsBack(nav, "CPS Course")
        repeat(5) {
            Box(Modifier.fillMaxWidth().height(76.dp).background(MaterialTheme.colorScheme.surfaceVariant, CpsSmallRadius))
        }
    }
}

private fun cleanCpsText(value: String): String = value
    .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
    .replace(Regex("<[^>]+>"), "")
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .trim()

private fun formatCpsDate(timestamp: Long): String = runCatching {
    SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault()).format(Date(timestamp))
}.getOrDefault("the configured expiry")
