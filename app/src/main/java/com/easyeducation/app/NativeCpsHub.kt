package com.easyeducation.app

import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController

private val CpsHomeRadius = RoundedCornerShape(22.dp)

@Composable
fun NativeCpsHomeBlock(nav: NavHostController, state: NativeUiState) {
    val now = System.currentTimeMillis()
    val unlocked = state.cpsCourses.count { entry -> entry.hasAccess && (entry.accessExpiresAtMs == 0L || entry.accessExpiresAtMs > now) }
    val live = state.cpsLiveHighlights.firstOrNull()
    val running = live?.status?.lowercase() in setOf("live", "running", "ongoing", "started", "live now")
    val surface = MaterialTheme.colorScheme.primaryContainer
    val content = MaterialTheme.colorScheme.onPrimaryContainer

    Column(Modifier.fillMaxWidth()) {
        NativeCpsEnrolledLiveHomeCard(nav, state)
        Spacer(Modifier.height(10.dp))
        Card(
            modifier = Modifier.fillMaxWidth().clickable { nav.navigate("cps") },
            shape = CpsHomeRadius,
            colors = CardDefaults.cardColors(containerColor = surface, contentColor = content),
        ) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(16.dp), color = content.copy(alpha = .10f)) {
                    Icon(Icons.Default.School, null, Modifier.padding(11.dp).size(27.dp), tint = content)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("CPS", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.width(8.dp))
                        Surface(shape = RoundedCornerShape(999.dp), color = content.copy(alpha = .10f)) {
                            Text("LIVE + INSTANT", Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                    }
                    Text("${state.cpsCourses.size} courses • $unlocked unlocked", style = MaterialTheme.typography.bodySmall, color = content.copy(alpha = .76f))
                    Text(
                        if (live == null) "Live classes, exams, resources, routine and topics"
                        else buildString {
                            append(if (running) "LIVE NOW • " else "TODAY • ")
                            if (live.courseTitle.isNotBlank()) append("${live.courseTitle} • ")
                            append(live.title)
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = content.copy(alpha = .86f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(8.dp))
                Surface(shape = CircleShape, color = content.copy(alpha = .10f)) {
                    Icon(Icons.Default.ArrowForward, "Open CPS", Modifier.padding(9.dp).size(20.dp), tint = content)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        NativeTrialHomeBanner()
    }
}

@Composable
fun NativeCpsCatalogScreen(nav: NavHostController, state: NativeUiState) {
    var query by rememberSaveable { mutableStateOf("") }
    val filtered = state.cpsCourses.filter { entry ->
        query.isBlank() || entry.course.title.contains(query, ignoreCase = true) || entry.course.description.contains(query, ignoreCase = true)
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            singleLine = true,
            label = { Text("Search courses") },
        )
        if (query.isBlank()) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().weight(1f)) { NativeCpsCatalogScreenV2(nav, state) }
        } else {
            LazyColumn(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (filtered.isEmpty()) item { Text("No CPS course matched your search.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(filtered, key = { it.course.id }) { entry ->
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("course/${entry.course.id}") },
                        shape = RoundedCornerShape(17.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    ) {
                        Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(entry.course.title, fontWeight = FontWeight.ExtraBold)
                                if (entry.course.description.isNotBlank()) Text(entry.course.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(if (entry.hasAccess) "Access active" else "Preview", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            }
                            Icon(Icons.Default.ArrowForward, null)
                        }
                    }
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
    NativeCpsCourseExperienceV5(nav, viewModel, state, courseId)
}
