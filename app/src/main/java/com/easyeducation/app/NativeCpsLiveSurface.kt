package com.easyeducation.app

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

private val CpsLiveHotCard = RoundedCornerShape(20.dp)
private val CpsLiveRunningStatuses = setOf("live", "running", "ongoing", "started", "live now", "in progress", "active")
private val CpsLiveFinishedStatuses = setOf("ended", "finished", "completed", "cancelled", "canceled")

private data class CpsLiveSurfaceItem(
    val id: String,
    val courseId: String,
    val courseTitle: String,
    val title: String,
    val startTime: String,
    val status: String,
    val url: String,
)

private fun liveStartMs(value: String): Long {
    val raw = value.trim()
    if (raw.isBlank()) return 0L
    return runCatching { Instant.parse(raw).toEpochMilli() }.getOrElse {
        runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrElse {
            runCatching { ZonedDateTime.parse(raw).toInstant().toEpochMilli() }.getOrDefault(0L)
        }
    }
}

private fun liveIsRelevant(status: String, startTime: String, now: Long = System.currentTimeMillis()): Boolean {
    val normalized = status.trim().lowercase()
    if (normalized in CpsLiveFinishedStatuses) return false
    if (normalized in CpsLiveRunningStatuses) return true
    val start = liveStartMs(startTime)
    if (start <= 0L) return false
    val delta = now - start
    // Some CPS live rows keep status="upcoming" after the stream starts. Treat a recent
    // start as live so the class does not disappear merely because status propagation lags.
    return delta in 0L..(6L * 60L * 60L * 1000L)
}

private fun liveLabel(item: CpsLiveSurfaceItem): String =
    if (item.status.trim().lowercase() in CpsLiveRunningStatuses || liveIsRelevant(item.status, item.startTime)) "LIVE NOW" else "LIVE"

private fun activeCpsCourseIds(state: NativeUiState): Set<String> {
    val now = System.currentTimeMillis()
    return state.cpsCourses
        .filter { it.hasAccess && (it.accessExpiresAtMs == 0L || it.accessExpiresAtMs > now) }
        .map { it.course.id }
        .toSet()
}

private fun academicLiveItems(state: NativeUiState, bundles: Map<String, NativeCpsAcademicBundle>): List<CpsLiveSurfaceItem> {
    val activeIds = activeCpsCourseIds(state)
    return activeIds.flatMap { courseId ->
        val title = state.cpsCourses.firstOrNull { it.course.id == courseId }?.course?.title.orEmpty()
        bundles[courseId]?.liveClasses.orEmpty()
            .filter { it.hasAccess && it.url.isNotBlank() && liveIsRelevant(it.status, it.startTime) }
            .map {
                CpsLiveSurfaceItem(
                    id = it.id,
                    courseId = courseId,
                    courseTitle = title,
                    title = it.title,
                    startTime = it.startTime,
                    status = it.status,
                    url = it.url,
                )
            }
    }
}

private fun catalogLiveItems(state: NativeUiState): List<CpsLiveSurfaceItem> {
    val activeIds = activeCpsCourseIds(state)
    return state.cpsLiveHighlights
        .filter { it.courseId in activeIds && it.hasAccess && it.url.isNotBlank() && liveIsRelevant(it.status, it.startTime) }
        .map {
            CpsLiveSurfaceItem(
                id = it.id,
                courseId = it.courseId,
                courseTitle = it.courseTitle,
                title = it.title,
                startTime = it.startTime,
                status = it.status,
                url = it.url,
            )
        }
}

@Composable
fun NativeCpsEnrolledLiveHomeCard(nav: NavHostController, state: NativeUiState) {
    val context = LocalContext.current
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    val activeIds = remember(state.cpsCourses) { activeCpsCourseIds(state).sorted() }

    LaunchedEffect(activeIds, state.online) {
        activeIds.forEach { courseId ->
            NativeCpsAcademicStore.seed(context, courseId)
            if (state.online) NativeCpsAcademicStore.refresh(context, courseId, online = true, force = true)
        }
    }

    val live = remember(state.cpsLiveHighlights, state.cpsCourses, bundles) {
        (academicLiveItems(state, bundles) + catalogLiveItems(state))
            .distinctBy { "${it.courseId}:${it.id}" }
            .sortedWith(compareBy<CpsLiveSurfaceItem> { if (liveIsRelevant(it.status, it.startTime)) 0 else 1 }.thenBy { liveStartMs(it.startTime) })
            .firstOrNull()
    } ?: return

    NativeCpsLiveNowCard(context, live, Modifier.fillMaxWidth())
}

@Composable
private fun NativeCpsLiveNowCard(context: Context, live: CpsLiveSurfaceItem, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.clickable { NativeCpsLivePlayerActivity.openLive(context, live.title, live.url, live.id) },
        shape = CpsLiveHotCard,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = .45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.error) {
                Icon(Icons.Default.LiveTv, null, Modifier.padding(10.dp).size(22.dp), tint = MaterialTheme.colorScheme.onError)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(liveLabel(live), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold)
                Text(live.title, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (live.courseTitle.isNotBlank()) {
                    Text(live.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = .78f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.width(8.dp))
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.error) {
                Icon(Icons.Default.PlayArrow, "Join live class", Modifier.padding(8.dp).size(22.dp), tint = MaterialTheme.colorScheme.onError)
            }
        }
    }
}

@Composable
fun NativeCpsCourseExperienceV5(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()

    LaunchedEffect(courseId, state.online) {
        NativeCpsAcademicStore.seed(context, courseId)
        if (state.online) NativeCpsAcademicStore.refresh(context, courseId, online = true, force = true)
    }

    val live = remember(state.cpsCourses, bundles, courseId) {
        academicLiveItems(state, bundles).firstOrNull { it.courseId == courseId }
    }

    Column(Modifier.fillMaxSize()) {
        if (live != null) {
            NativeCpsLiveNowCard(context, live, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp))
        }
        Box(Modifier.weight(1f)) {
            NativeCpsCourseExperienceV4(nav, viewModel, state, courseId)
        }
    }
}
