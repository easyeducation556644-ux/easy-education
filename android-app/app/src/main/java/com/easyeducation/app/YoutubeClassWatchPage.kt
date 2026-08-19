@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

private val trackedClassViews = ConcurrentHashMap.newKeySet<String>()

@Composable
fun YoutubeClassWatchPage(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    classId: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FirebaseFirestore.getInstance() }
    val content = state.courseContent[courseId]

    LaunchedEffect(courseId) {
        if (state.courseContent[courseId] == null) viewModel.loadCourse(courseId)
    }

    if (content == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val classItem = content.classes.firstOrNull { it.id == classId }
    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    if (classItem == null || course == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    val task = state.downloads.firstOrNull { it.classId == classId }
    var qualitySheet by remember(classId) { mutableStateOf(false) }
    var resourcesSheet by remember(classId) { mutableStateOf(false) }
    var descriptionSheet by remember(classId) { mutableStateOf(false) }
    var likes by remember(classId) { mutableIntStateOf(0) }
    var dislikes by remember(classId) { mutableIntStateOf(0) }
    var views by remember(classId) { mutableIntStateOf(0) }
    var myReaction by remember(classId, state.user?.uid) { mutableStateOf<String?>(null) }

    val chapterClasses = remember(content.classes, classItem.id) {
        classesInSameSubjectAndChapter(content.classes, classItem)
    }
    val currentIndex = chapterClasses.indexOfFirst { it.id == classItem.id }
    val previousClass = chapterClasses.getOrNull(currentIndex - 1)
    val nextClass = chapterClasses.getOrNull(currentIndex + 1)
    val queueScope = remember(classItem.id, classItem.subjects, classItem.chapters) {
        val subject = classItem.subjects.joinToString("|") { it.lowercase() }
        val chapter = classItem.chapters.joinToString("|") { it.lowercase() }
        "$courseId::$subject::$chapter"
    }

    LaunchedEffect(queueScope, chapterClasses) {
        PlayerChapterQueue.set(
            queueScope,
            chapterClasses.map {
                PlayerQueueItem(
                    courseId = courseId,
                    classId = it.id,
                    title = it.title,
                    sourceUrl = it.sourceUrl,
                    height = 480,
                )
            },
        )
    }

    LaunchedEffect(nextClass?.id, state.online) {
        if (state.online && nextClass != null) {
            PersistentNativePlayer.prefetch(context, nextClass.id, nextClass.sourceUrl, 480)
        }
    }

    DisposableEffect(classId, state.user?.uid) {
        val reactionListener = db.collection("classReactions")
            .whereEqualTo("classId", classId)
            .addSnapshotListener { snapshot, _ ->
                val docs = snapshot?.documents.orEmpty()
                likes = docs.count { it.getString("type") == "like" }
                dislikes = docs.count { it.getString("type") == "dislike" }
                val uid = state.user?.uid
                myReaction = if (uid == null) null
                else docs.firstOrNull { it.getString("userId") == uid }?.getString("type")
            }
        val viewListener = db.collection("classViews")
            .whereEqualTo("classId", classId)
            .addSnapshotListener { snapshot, _ -> views = snapshot?.size() ?: 0 }
        onDispose {
            reactionListener.remove()
            viewListener.remove()
        }
    }

    LaunchedEffect(classId, state.user?.uid) {
        val user = state.user ?: return@LaunchedEffect
        val key = "${user.uid}:$classId"
        if (trackedClassViews.add(key)) {
            runCatching {
                withContext(Dispatchers.IO) {
                    db.collection("classViews").add(
                        mapOf(
                            "userId" to user.uid,
                            "classId" to classId,
                            "timestamp" to FieldValue.serverTimestamp(),
                        ),
                    ).await()
                }
            }.onFailure { trackedClassViews.remove(key) }
        }
    }

    LaunchedEffect(state.qualityOptions[classId], state.qualityLoadingClassId) {
        if (state.qualityOptions[classId]?.isNotEmpty() == true) qualitySheet = true
    }

    fun navigateTo(target: NativeClassItem?) {
        if (target == null || target.id == classId) return
        PersistentNativePlayer.prefetch(context, target.id, target.sourceUrl, 480)
        nav.navigate("class/$courseId/${target.id}") {
            launchSingleTop = true
            popUpTo("class/{courseId}/{classId}") { inclusive = true }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        item(key = "player-$classId") {
            NativeInlinePlayer(
                classId = classId,
                sourceUrl = classItem.sourceUrl,
                online = state.online,
                requestedHeight = 480,
                title = classItem.title,
                hasPrevious = previousClass != null,
                hasNext = nextClass != null,
                onPrevious = { navigateTo(previousClass) },
                onNext = { navigateTo(nextClass) },
                onSharedSessionClassChanged = { activeId ->
                    chapterClasses.firstOrNull { it.id == activeId }?.let(::navigateTo)
                },
                onBack = { nav.popBackStack() },
                onMinimize = { nav.popBackStack() },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        item(key = "title-$classId") {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { descriptionSheet = true },
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Text(
                        classItem.title,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 19.sp,
                        lineHeight = 23.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(5.dp))
                    Text(
                        buildWatchMeta(likes, views, classItem.publishedAt),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        item(key = "actions-$classId") {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.background,
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    WatchActionChip(
                        icon = { Icon(Icons.Default.ThumbUp, null, Modifier.size(19.dp)) },
                        label = if (likes > 0) compactNumber(likes) else "Like",
                        selected = myReaction == "like",
                        enabled = state.user != null,
                    ) {
                        state.user?.let { user ->
                            scope.launch { toggleReaction(db, classId, user, "like", myReaction == "like") }
                        }
                    }
                    WatchActionChip(
                        icon = { Icon(Icons.Default.ThumbDown, null, Modifier.size(19.dp)) },
                        label = if (dislikes > 0) compactNumber(dislikes) else "Dislike",
                        selected = myReaction == "dislike",
                        enabled = state.user != null,
                    ) {
                        state.user?.let { user ->
                            scope.launch { toggleReaction(db, classId, user, "dislike", myReaction == "dislike") }
                        }
                    }

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
                                } else Icon(Icons.Default.Download, null, Modifier.size(20.dp))
                            },
                            label = "Download",
                            enabled = state.online && state.qualityLoadingClassId != classId && classItem.downloadUrl.isNotBlank(),
                        ) {
                            viewModel.loadDownloadQualities(classItem)
                            qualitySheet = true
                        }
                    }

                    WatchActionChip(
                        icon = { Icon(Icons.Default.FolderOpen, null, Modifier.size(20.dp)) },
                        label = "Resources",
                        enabled = classItem.resourceLinks.isNotEmpty(),
                    ) { resourcesSheet = true }
                }
            }
        }

        item(key = "comments-$classId") {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 12.dp),
                color = MaterialTheme.colorScheme.background,
            ) {
                YoutubeCommentsBlock(
                    classId = classId,
                    courseId = courseId,
                    classTitle = classItem.title,
                    user = state.user,
                )
            }
        }

        item(key = "up-next-$classId") {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.background,
            ) {
                Column(Modifier.fillMaxWidth()) {
                    HorizontalDivider()
                    Text(
                        "Up next",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    if (nextClass != null) {
                        YoutubeNextClassCard(nextClass) { navigateTo(nextClass) }
                    } else {
                        Surface(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Text(
                                "এই chapter-এর শেষ class এটি — আর video নেই।",
                                modifier = Modifier.padding(18.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }

    if (descriptionSheet) {
        WatchDescriptionSheet(
            classItem = classItem,
            likes = likes,
            views = views,
            onDismiss = { descriptionSheet = false },
            onOpenResource = { resource ->
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resource.url))) }
            },
        )
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
                                    val size = if (option.sizeBytes > 0L) DownloadNotifier.formatBytes(option.sizeBytes)
                                    else "Size calculated during download"
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
                if (classItem.resourceLinks.isEmpty()) {
                    Text("No resources are attached to this class.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else classItem.resourceLinks.forEach { resource ->
                    Surface(
                        modifier = Modifier.fillMaxWidth().clickable {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resource.url))) }
                        },
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(13.dp),
                    ) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
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
private fun WatchDescriptionSheet(
    classItem: NativeClassItem,
    likes: Int,
    views: Int,
    onDismiss: () -> Unit,
    onOpenResource: (NativeResourceLink) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(bottom = 30.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Description", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Close description") }
                }
                HorizontalDivider()
            }
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 20.dp)) {
                        Text(
                            classItem.title,
                            fontSize = 21.sp,
                            lineHeight = 27.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(18.dp))
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            StatBox(compactNumber(likes), "Likes", Modifier.weight(1f))
                            StatBox(compactNumber(views), "Views", Modifier.weight(1f))
                            StatBox(descriptionDate(classItem.publishedAt), relativeAge(classItem.publishedAt), Modifier.weight(1f))
                        }
                    }
                }
            }
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                        Text("@EasyEducation", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                        if (classItem.duration.isNotBlank()) {
                            Spacer(Modifier.height(5.dp))
                            Text("Class duration • ${classItem.duration}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (classItem.topic.isNotBlank() && !classItem.topic.equals(classItem.title, true)) {
                            Spacer(Modifier.height(10.dp))
                            Text(classItem.topic, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            }
            item {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 18.dp)) {
                    Text("Resources", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    if (classItem.resourceLinks.isEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(15.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                "No resources are attached to this class.",
                                modifier = Modifier.padding(16.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else classItem.resourceLinks.forEach { resource ->
                        Surface(
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable { onOpenResource(resource) },
                            shape = RoundedCornerShape(15.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.FolderOpen, null, Modifier.size(20.dp))
                                Spacer(Modifier.width(10.dp))
                                Text(resource.label, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatBox(value: String, label: String, modifier: Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(horizontal = 8.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value.ifBlank { "—" }, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Spacer(Modifier.height(3.dp))
            Text(label.ifBlank { "Published" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun WatchActionChip(
    icon: @Composable () -> Unit,
    label: String,
    enabled: Boolean = true,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = when {
            !enabled -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
            selected -> MaterialTheme.colorScheme.onSurface
            else -> MaterialTheme.colorScheme.surfaceVariant
        },
    ) {
        Row(
            Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            if (selected) {
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.surface,
                ) { icon(); Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge) }
            } else {
                icon()
                Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun YoutubeNextClassCard(item: NativeClassItem, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(bottom = 16.dp),
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
        Column(Modifier.padding(horizontal = 14.dp)) {
            Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 20.sp)
            val meta = listOf("@EasyEducation", item.duration).filter { it.isNotBlank() }.joinToString("  •  ")
            Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

private fun classesInSameSubjectAndChapter(
    classes: List<NativeClassItem>,
    current: NativeClassItem,
): List<NativeClassItem> {
    val currentSubjects = current.subjects.normalizedSet()
    val currentChapters = current.chapters.normalizedSet()
    return classes.filter { candidate ->
        val candidateSubjects = candidate.subjects.normalizedSet()
        val candidateChapters = candidate.chapters.normalizedSet()
        val subjectMatches = if (currentSubjects.isEmpty()) candidateSubjects.isEmpty()
        else candidateSubjects.any { it in currentSubjects }
        val chapterMatches = if (currentChapters.isEmpty()) candidateChapters.isEmpty()
        else candidateChapters.any { it in currentChapters }
        subjectMatches && chapterMatches
    }.sortedWith(compareBy<NativeClassItem> { it.order }.thenBy { it.id })
}

private fun List<String>.normalizedSet(): Set<String> =
    map { it.trim().lowercase() }.filter { it.isNotBlank() && it != "[]" }.toSet()

private suspend fun toggleReaction(
    db: FirebaseFirestore,
    classId: String,
    user: FirebaseUser,
    type: String,
    remove: Boolean,
) {
    runCatching {
        withContext(Dispatchers.IO) {
            val ref = db.collection("classReactions").document("${user.uid}_$classId")
            if (remove) ref.delete().await()
            else ref.set(
                mapOf(
                    "userId" to user.uid,
                    "userName" to (user.displayName ?: user.email ?: "Student"),
                    "userPhoto" to (user.photoUrl?.toString() ?: ""),
                    "classId" to classId,
                    "type" to type,
                    "timestamp" to FieldValue.serverTimestamp(),
                ),
            ).await()
        }
    }
}

private fun buildWatchMeta(likes: Int, views: Int, publishedAt: Long): String {
    val pieces = mutableListOf("@EasyEducation")
    pieces += "${compactNumber(likes)} likes"
    pieces += "${compactNumber(views)} views"
    relativeAge(publishedAt).takeIf { it.isNotBlank() }?.let(pieces::add)
    return pieces.joinToString("  ")
}

private fun compactNumber(value: Int): String = when {
    value >= 1_000_000 -> "%.1fm".format(Locale.US, value / 1_000_000f).removeSuffix(".0m") + if (value % 1_000_000 == 0) "m" else ""
    value >= 1_000 -> "%.1fk".format(Locale.US, value / 1_000f).replace(".0k", "k")
    else -> value.toString()
}

private fun relativeAge(time: Long): String {
    if (time <= 0L) return ""
    val delta = (System.currentTimeMillis() - time).coerceAtLeast(0L)
    return when {
        delta < 60_000L -> "now"
        delta < 3_600_000L -> "${delta / 60_000L} min ago"
        delta < 86_400_000L -> "${delta / 3_600_000L} hr ago"
        delta < 604_800_000L -> "${delta / 86_400_000L} day${if (delta / 86_400_000L == 1L) "" else "s"} ago"
        delta < 2_592_000_000L -> "${delta / 604_800_000L} wk ago"
        delta < 31_536_000_000L -> "${delta / 2_592_000_000L} mo ago"
        else -> "${delta / 31_536_000_000L} yr ago"
    }
}

private fun descriptionDate(time: Long): String {
    if (time <= 0L) return "—"
    return SimpleDateFormat("dd MMM", Locale.getDefault()).format(Date(time))
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
