@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage

/**
 * Native watch page structured around the interaction hierarchy users know from YouTube mobile:
 * edge-to-edge player, title/meta, creator row, compact actions, comments, then watch-next cards.
 */
@Composable
fun YoutubeClassWatchPage(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    classId: String,
) {
    val context = LocalContext.current
    val content = state.courseContent[courseId]
    if (content == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    val classItem = content.classes.firstOrNull { it.id == classId }
    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    if (classItem == null || course == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val task = state.downloads.firstOrNull { it.classId == classId }
    var qualitySheet by remember(classId) { mutableStateOf(false) }
    var resourcesSheet by remember(classId) { mutableStateOf(false) }

    LaunchedEffect(state.qualityOptions[classId], state.qualityLoadingClassId) {
        if (state.qualityOptions[classId]?.isNotEmpty() == true) qualitySheet = true
    }

    val relatedClasses = remember(content.classes, classItem.id) {
        val sameChapter = classItem.chapters.firstOrNull()?.let { chapter ->
            content.classes.filter { candidate ->
                candidate.id != classItem.id && candidate.chapters.any { it.equals(chapter, true) }
            }
        }.orEmpty()
        (sameChapter + content.classes.filter { it.id != classItem.id })
            .distinctBy { it.id }
            .sortedBy { it.order }
            .take(24)
    }

    // Keep only one next class warm. It gives the familiar instant next-video feel without resolving
    // every class in a chapter or wasting mobile data on a large background queue.
    LaunchedEffect(classId, relatedClasses.firstOrNull()?.id, state.online) {
        if (state.online) {
            relatedClasses.firstOrNull()?.let { next ->
                PersistentNativePlayer.prefetch(context, next.id, next.sourceUrl, 480)
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 18.dp),
    ) {
        item(key = "player-$classId") {
            NativeInlinePlayer(
                classId = classId,
                sourceUrl = classItem.sourceUrl,
                online = state.online,
                requestedHeight = 480,
                title = classItem.title,
                onBack = { nav.popBackStack() },
                onMinimize = { nav.popBackStack() },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        item(key = "info-$classId") {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    classItem.title,
                    fontSize = 20.sp,
                    lineHeight = 25.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )

                val meta = buildList {
                    classItem.duration.takeIf { it.isNotBlank() }?.let(::add)
                    classItem.topic.takeIf { it.isNotBlank() && !it.equals(classItem.title, true) }?.let(::add)
                    add(course.title)
                }.joinToString("  •  ")
                if (meta.isNotBlank()) {
                    Text(
                        meta,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Row(
                    Modifier.fillMaxWidth().padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TeacherAvatar(classItem.teacherImageUrl, Modifier.size(42.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            classItem.teacherName.ifBlank { "Easy Education" },
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            course.title,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme.onBackground,
                    ) {
                        Text(
                            "Enrolled",
                            modifier = Modifier.padding(horizontal = 15.dp, vertical = 9.dp),
                            color = MaterialTheme.colorScheme.background,
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }

                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    when (task?.state) {
                        "completed" -> WatchActionChip(
                            icon = { Icon(Icons.Default.PlayArrow, null, Modifier.size(20.dp)) },
                            label = "Offline",
                            enabled = viewModel.hasOfflineLease(courseId),
                        ) {
                            context.startActivity(
                                Intent(context, NativePlayerActivity::class.java)
                                    .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, task.id)
                                    .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, classItem.id)
                                    .putExtra(NativePlayerActivity.EXTRA_TITLE, classItem.title),
                            )
                        }

                        "downloading", "queued" -> WatchActionChip(
                            icon = { Icon(Icons.Default.Pause, null, Modifier.size(20.dp)) },
                            label = "Pause ${task.progress}%",
                        ) { viewModel.pauseDownload(context, task.id) }

                        "paused", "failed" -> WatchActionChip(
                            icon = { Icon(Icons.Default.Refresh, null, Modifier.size(20.dp)) },
                            label = "Resume",
                        ) { viewModel.resumeDownload(context, task.id) }

                        else -> WatchActionChip(
                            icon = {
                                if (state.qualityLoadingClassId == classId) {
                                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.Download, null, Modifier.size(20.dp))
                                }
                            },
                            label = "Download",
                            enabled = state.online &&
                                state.qualityLoadingClassId != classId &&
                                classItem.downloadUrl.isNotBlank(),
                        ) {
                            viewModel.loadDownloadQualities(classItem)
                            qualitySheet = true
                        }
                    }

                    WatchActionChip(
                        icon = { Icon(Icons.Default.FolderOpen, null, Modifier.size(20.dp)) },
                        label = if (classItem.resourceLinks.isEmpty()) "Resources" else "Resources ${classItem.resourceLinks.size}",
                        enabled = classItem.resourceLinks.isNotEmpty(),
                    ) { resourcesSheet = true }
                }

                NativeClassSocial(classId = classItem.id, user = state.user)

                if (task != null) {
                    Text(
                        "${task.qualityLabel.ifBlank { "${task.height}p" }}  •  ${watchDownloadState(task)}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (relatedClasses.isNotEmpty()) {
            item(key = "up-next-title") {
                Text(
                    "Up next",
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            items(relatedClasses, key = { "next-${it.id}" }) { next ->
                YoutubeNextClassCard(
                    item = next,
                    onClick = {
                        PersistentNativePlayer.prefetch(context, next.id, next.sourceUrl, 480)
                        nav.navigate("class/$courseId/${next.id}") {
                            launchSingleTop = true
                        }
                    },
                )
            }
        }
    }

    if (qualitySheet) {
        ModalBottomSheet(
            onDismissRequest = {
                qualitySheet = false
                if (state.qualityLoadingClassId != classId) viewModel.clearDownloadQualities(classId)
            },
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Download quality", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Choose the source quality", color = MaterialTheme.colorScheme.onSurfaceVariant)
                when {
                    state.qualityLoadingClassId == classId -> Row(
                        Modifier.padding(vertical = 24.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Checking available qualities…")
                    }

                    state.qualityOptions[classId].orEmpty().isEmpty() -> Text(
                        "No downloadable quality is available right now.",
                        modifier = Modifier.padding(vertical = 18.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    else -> state.qualityOptions[classId].orEmpty().forEach { option ->
                        Surface(
                            modifier = Modifier.fillMaxWidth().clickable {
                                viewModel.startDownload(context, course, classItem, option)
                                qualitySheet = false
                            },
                            shape = RoundedCornerShape(13.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Row(
                                Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(option.label, fontWeight = FontWeight.Bold)
                                    val size = if (option.sizeBytes > 0L) {
                                        DownloadNotifier.formatBytes(option.sizeBytes)
                                    } else "Size calculated during download"
                                    Text(
                                        size + if (option.estimated) " approx." else "",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Icon(Icons.Default.Download, null)
                            }
                        }
                    }
                }
            }
        }
    }

    if (resourcesSheet) {
        ModalBottomSheet(onDismissRequest = { resourcesSheet = false }) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Resources", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                classItem.resourceLinks.forEach { resource ->
                    Surface(
                        modifier = Modifier.fillMaxWidth().clickable {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resource.url)))
                            }
                        },
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(13.dp),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Language, null, Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text(resource.label, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchActionChip(
    icon: @Composable () -> Unit,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = if (enabled) MaterialTheme.colorScheme.surfaceVariant
        else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            icon()
            Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun YoutubeNextClassCard(item: NativeClassItem, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(bottom = 16.dp),
    ) {
        if (item.imageUrl.isNotBlank()) {
            AsyncImage(
                model = item.imageUrl,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp)
                    .aspectRatio(16f / 9f)
                    .clip(RoundedCornerShape(12.dp)),
            )
        } else {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp)
                    .aspectRatio(16f / 9f)
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.PlayArrow, null, Modifier.size(44.dp))
            }
        }
        Spacer(Modifier.height(9.dp))
        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.Top) {
            TeacherAvatar(item.teacherImageUrl, Modifier.size(38.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    item.title,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 20.sp,
                )
                val meta = listOf(item.teacherName, item.duration).filter { it.isNotBlank() }.joinToString("  •  ")
                if (meta.isNotBlank()) {
                    Text(
                        meta,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun TeacherAvatar(url: String, modifier: Modifier) {
    if (url.isNotBlank()) {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(CircleShape),
        )
    } else {
        Surface(modifier = modifier, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Person, null, Modifier.size(21.dp))
            }
        }
    }
}

private fun watchDownloadState(task: SecureDownloadTask): String = when (task.state) {
    "completed" -> "Offline ready"
    "paused" -> "Paused"
    "failed" -> "Needs attention"
    "queued" -> "Queued"
    else -> when (task.phase) {
        "converting" -> "Preparing video"
        "encrypting" -> "Securing video"
        "preparing" -> "Preparing"
        else -> "${task.progress}%"
    }
}
