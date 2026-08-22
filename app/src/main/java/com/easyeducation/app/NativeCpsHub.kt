package com.easyeducation.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
    NativeCpsCatalogScreenV2(nav, state)
}

@Composable
fun NativeCpsCourseScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    NativeCpsCourseExperienceV4(nav, viewModel, state, courseId)
}
