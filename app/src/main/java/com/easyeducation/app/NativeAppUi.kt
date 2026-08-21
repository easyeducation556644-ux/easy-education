@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private data class BottomItem(
    val route: String,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private val bottomItems = listOf(
    BottomItem("home", "Home", Icons.Default.Home),
    BottomItem("courses", "My Courses", Icons.Default.School),
    BottomItem("downloads", "Downloads", Icons.Default.Download),
    BottomItem("profile", "Profile", Icons.Default.Person),
)

private val PillShape = RoundedCornerShape(999.dp)

@Composable
fun EasyEducationNativeApp(
    viewModel: NativeAppViewModel,
    onGoogleSignIn: () -> Unit,
    initialPath: String? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    EasyEducationTheme {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                !state.authReady -> NativeSplash()
                state.user == null -> LoginScreen(state.online, onGoogleSignIn)
                else -> {
                    val navController = rememberNavController()
                    val startRoute = if (initialPath == "/downloads") "downloads" else "home"
                    val backStack by navController.currentBackStackEntryAsState()
                    val currentRoute = backStack?.destination?.route.orEmpty()

                    LaunchedEffect(state.error) {
                        state.error?.let { message ->
                            snackbar.showSnackbar(message)
                            viewModel.clearError()
                        }
                    }

                    Scaffold(
                        snackbarHost = { SnackbarHost(snackbar) },
                        containerColor = MaterialTheme.colorScheme.background,
                        bottomBar = {
                            NavigationBar(
                                containerColor = MaterialTheme.colorScheme.surface,
                                tonalElevation = 0.dp,
                            ) {
                                bottomItems.forEach { item ->
                                    val selected = currentRoute == item.route ||
                                        (item.route == "courses" && currentRoute.startsWith("course/"))
                                    NavigationBarItem(
                                        selected = selected,
                                        onClick = {
                                            navController.navigate(item.route) {
                                                launchSingleTop = true
                                                restoreState = true
                                                popUpTo("home") { saveState = true }
                                            }
                                        },
                                        icon = { Icon(item.icon, contentDescription = item.label) },
                                        label = { Text(item.label) },
                                    )
                                }
                            }
                        },
                    ) { padding ->
                        Column(Modifier.fillMaxSize().padding(padding)) {
                            if (!state.online) OfflineBanner()
                            if (state.syncing) LinearProgressIndicator(Modifier.fillMaxWidth())
                            NativeNavHost(navController, viewModel, state, startRoute)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeSplash() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(76.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(20.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.School, null, modifier = Modifier.size(42.dp), tint = MaterialTheme.colorScheme.onPrimary)
            }
            Spacer(Modifier.height(18.dp))
            Text("Easy Education", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(14.dp))
            CircularProgressIndicator(strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun LoginScreen(online: Boolean, onGoogleSignIn: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        OutlinedCardContainer {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(64.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(18.dp)),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.School, null, tint = MaterialTheme.colorScheme.onPrimary) }
                Spacer(Modifier.height(14.dp))
                Text("Easy Education", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Native learning • secure offline classes", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(28.dp))
                Button(onClick = onGoogleSignIn, enabled = online, shape = PillShape, modifier = Modifier.fillMaxWidth()) {
                    Text("Continue with Google")
                }
                if (!online) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.CloudOff, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("First sign-in requires internet.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineBanner() {
    Row(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.CloudOff, null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Offline mode — cached courses and saved classes still work.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun NativeNavHost(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    startRoute: String,
) {
    NavHost(navController = nav, startDestination = startRoute, modifier = Modifier.fillMaxSize()) {
        composable("home") { HomeScreen(nav, viewModel, state) }
        composable("courses") { CoursesScreen(nav, state) }
        composable("downloads") { DownloadsScreen(nav, viewModel, state) }
        composable("profile") { ProfileScreen(viewModel, state) }
        composable("course/{courseId}", listOf(navArgument("courseId") { type = NavType.StringType })) { entry ->
            CourseScreen(nav, viewModel, state, entry.arguments?.getString("courseId").orEmpty())
        }
        composable(
            "subject/{courseId}/{subject}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("subject") { type = NavType.StringType },
            ),
        ) { entry ->
            SubjectScreen(
                nav,
                state,
                entry.arguments?.getString("courseId").orEmpty(),
                Uri.decode(entry.arguments?.getString("subject").orEmpty()),
            )
        }
        composable(
            "chapter/{courseId}/{subject}/{chapter}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("subject") { type = NavType.StringType },
                navArgument("chapter") { type = NavType.StringType },
            ),
        ) { entry ->
            ChapterScreen(
                nav,
                state,
                entry.arguments?.getString("courseId").orEmpty(),
                Uri.decode(entry.arguments?.getString("subject").orEmpty()),
                Uri.decode(entry.arguments?.getString("chapter").orEmpty()),
            )
        }
        composable(
            "class/{courseId}/{classId}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("classId") { type = NavType.StringType },
            ),
        ) { entry ->
            ClassScreen(
                nav,
                viewModel,
                state,
                entry.arguments?.getString("courseId").orEmpty(),
                entry.arguments?.getString("classId").orEmpty(),
            )
        }
    }
}

@Composable
private fun HomeScreen(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState) {
    val ready = state.downloads.count { it.state == "completed" }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Text(
                "Hi ${state.profile?.name?.substringBefore(' ')?.ifBlank { "Student" } ?: "Student"}",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Text("Continue learning with less data usage.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("My Courses", state.courses.size.toString(), Modifier.weight(1f))
                StatCard("Offline Ready", ready.toString(), Modifier.weight(1f))
            }
        }
        item {
            Button(onClick = { nav.navigate("courses") }, shape = PillShape, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.School, null)
                Spacer(Modifier.width(8.dp))
                Text("Open My Courses")
            }
        }
        item {
            OutlinedButton(onClick = { nav.navigate("downloads") }, shape = PillShape, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Download, null)
                Spacer(Modifier.width(8.dp))
                Text("Downloads")
            }
        }
        if (state.online) {
            item { TextButton(onClick = { viewModel.refreshOnline() }) { Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Sync now") } }
        }
        if (state.courses.isNotEmpty()) {
            item { SectionTitle("Continue course") }
            items(state.courses.take(3), key = { it.id }) { course -> CourseCard(course) { nav.navigate("course/${course.id}") } }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CoursesScreen(nav: NavHostController, state: NativeUiState) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("My Courses", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Your enrolled courses are cached for fast access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.courses.isEmpty()) item { EmptyCard("No enrolled course is cached yet. Connect once to sync your account.") }
        else items(state.courses, key = { it.id }) { course -> CourseCard(course) { nav.navigate("course/${course.id}") } }
    }
}

@Composable
private fun CourseCard(course: NativeCourse, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(58.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.School, null) }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(course.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (course.courseFormat == "bundle") Text("Bundle", style = MaterialTheme.typography.labelSmall)
            }
            Text("›", style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun CourseScreen(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState, courseId: String) {
    LaunchedEffect(courseId) { viewModel.loadCourse(courseId) }
    val content = state.courseContent[courseId]
    val course = content?.course ?: state.courses.firstOrNull { it.id == courseId }
    if (content == null) { LoadingList("Loading course…"); return }
    if (!(state.online || viewModel.hasOfflineLease(courseId))) { LockedOfflineScreen(nav); return }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { BackHeader(nav, course?.title ?: "Course") }
        when {
            content.subjects.isNotEmpty() -> {
                item { SectionTitle("Subjects") }
                items(content.subjects, key = { it.id }) { subject ->
                    ContentRow(Icons.Default.School, subject.title) { nav.navigate("subject/$courseId/${Uri.encode(subject.title)}") }
                }
            }
            content.chapters.isNotEmpty() -> {
                item { SectionTitle("Chapters") }
                items(content.chapters, key = { it.id }) { chapter ->
                    ContentRow(Icons.Default.VideoLibrary, chapter.title) {
                        nav.navigate("chapter/$courseId/${Uri.encode(chapter.subject)}/${Uri.encode(chapter.title)}")
                    }
                }
            }
            else -> {
                item { SectionTitle("Classes") }
                items(content.classes, key = { it.id }) { classItem -> ClassRow(classItem) { nav.navigate("class/$courseId/${classItem.id}") } }
            }
        }
    }
}

@Composable
private fun SubjectScreen(nav: NavHostController, state: NativeUiState, courseId: String, subject: String) {
    val content = state.courseContent[courseId] ?: run { LoadingList("Loading subject…"); return }
    val chapters = content.chapters.filter { it.subject.isBlank() || it.subject.equals(subject, true) }
        .distinctBy { it.title.lowercase() }
    val classes = content.classes.filter { item -> item.subjects.any { it.equals(subject, true) } }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { BackHeader(nav, subject) }
        if (chapters.isNotEmpty()) items(chapters, key = { it.id }) { chapter ->
            ContentRow(Icons.Default.VideoLibrary, chapter.title) {
                nav.navigate("chapter/$courseId/${Uri.encode(subject)}/${Uri.encode(chapter.title)}")
            }
        } else items(classes, key = { it.id }) { classItem -> ClassRow(classItem) { nav.navigate("class/$courseId/${classItem.id}") } }
    }
}

@Composable
private fun ChapterScreen(nav: NavHostController, state: NativeUiState, courseId: String, subject: String, chapter: String) {
    val content = state.courseContent[courseId] ?: run { LoadingList("Loading chapter…"); return }
    val classes = content.classes.filter { item ->
        item.chapters.any { it.equals(chapter, true) } &&
            (subject.isBlank() || item.subjects.isEmpty() || item.subjects.any { it.equals(subject, true) })
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { BackHeader(nav, chapter) }
        if (classes.isEmpty()) item { EmptyCard("No class is cached for this chapter yet.") }
        items(classes, key = { it.id }) { classItem -> ClassRow(classItem) { nav.navigate("class/$courseId/${classItem.id}") } }
    }
}

@Composable
private fun ClassRow(item: NativeClassItem, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(46.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.PlayArrow, null) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (item.duration.isNotBlank()) Text(item.duration, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ClassScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    classId: String,
) {
    val context = LocalContext.current
    val content = state.courseContent[courseId]
    val item = content?.classes?.firstOrNull { it.id == classId }
    val course = content?.course ?: state.courses.firstOrNull { it.id == courseId }
    val task = state.downloads.firstOrNull { it.classId == classId }
    var showQualitySheet by remember(classId) { mutableStateOf(false) }
    var confirmDelete by remember(classId) { mutableStateOf(false) }

    if (item == null || course == null) { LoadingList("Loading class…"); return }

    if (showQualitySheet) {
        QualityBottomSheet(
            item = item,
            state = state,
            onDismiss = { showQualitySheet = false },
            onRefresh = { viewModel.clearDownloadQualities(item.id); viewModel.loadDownloadQualities(item) },
            onSelect = { option ->
                viewModel.startDownload(context, course, item, option)
                showQualitySheet = false
            },
        )
    }
    if (confirmDelete && task != null) {
        DeleteDownloadDialog(task.title, onDismiss = { confirmDelete = false }) {
            confirmDelete = false
            viewModel.removeDownload(context, task.id)
        }
    }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { BackHeader(nav, "Class") }
        item {
            OutlinedCardContainer {
                Column(Modifier.padding(18.dp)) {
                    Box(
                        Modifier.size(48.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Default.VideoLibrary, null, tint = MaterialTheme.colorScheme.onPrimary) }
                    Spacer(Modifier.height(12.dp))
                    Text(item.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    if (item.teacherName.isNotBlank()) Text(item.teacherName, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.duration.isNotBlank()) Text(item.duration, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item {
            Button(
                onClick = {
                    context.startActivity(
                        Intent(context, NativePlayerActivity::class.java)
                            .putExtra(NativePlayerActivity.EXTRA_SOURCE_URL, item.sourceUrl)
                            .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, item.id)
                            .putExtra(NativePlayerActivity.EXTRA_HEIGHT, 480),
                    )
                },
                enabled = state.online && item.sourceUrl.isNotBlank(),
                shape = PillShape,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(if (state.online) Icons.Default.PlayArrow else Icons.Default.CloudOff, null)
                Spacer(Modifier.width(8.dp))
                Text("Watch Online")
            }
        }

        task?.let { current ->
            item { DownloadStatusCard(current) }
            when (current.state) {
                "completed" -> {
                    item {
                        Button(
                            onClick = {
                                context.startActivity(
                                    Intent(context, NativePlayerActivity::class.java)
                                        .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, current.id)
                                        .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, item.id),
                                )
                            },
                            enabled = viewModel.hasOfflineLease(courseId),
                            shape = PillShape,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(if (viewModel.hasOfflineLease(courseId)) Icons.Default.PlayArrow else Icons.Default.Lock, null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (viewModel.hasOfflineLease(courseId)) "Play Offline" else "Connect to verify access")
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(
                                onClick = {
                                    showQualitySheet = true
                                    viewModel.clearDownloadQualities(item.id)
                                    viewModel.loadDownloadQualities(item)
                                },
                                enabled = state.online,
                                shape = PillShape,
                                modifier = Modifier.weight(1f),
                            ) { Text("Change quality") }
                            OutlinedButton(onClick = { confirmDelete = true }, shape = PillShape) {
                                Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
                "downloading", "queued" -> item {
                    OutlinedButton(
                        onClick = { viewModel.pauseDownload(context, current.id) },
                        shape = PillShape,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Icon(Icons.Default.Pause, null); Spacer(Modifier.width(8.dp)); Text("Pause download") }
                }
                "paused", "failed" -> item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = { viewModel.resumeDownload(context, current.id) },
                            enabled = state.online,
                            shape = PillShape,
                            modifier = Modifier.weight(1f),
                        ) { Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(6.dp)); Text(if (current.state == "failed") "Retry" else "Resume") }
                        OutlinedButton(onClick = { confirmDelete = true }, shape = PillShape) {
                            Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        if (task == null) {
            item {
                OutlinedCardContainer {
                    Column(Modifier.padding(18.dp)) {
                        Text("Save for offline", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(5.dp))
                        Text(
                            "Tap Download to check the real qualities available from this video. You will see each quality and its file size before anything starts.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(Modifier.height(14.dp))
                        Button(
                            onClick = {
                                showQualitySheet = true
                                viewModel.clearDownloadQualities(item.id)
                                viewModel.loadDownloadQualities(item)
                            },
                            enabled = state.online && item.downloadUrl.isNotBlank(),
                            shape = PillShape,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Icon(Icons.Default.Download, null); Spacer(Modifier.width(8.dp)); Text("Download") }
                    }
                }
            }
        }
    }
}

@Composable
private fun QualityBottomSheet(
    item: NativeClassItem,
    state: NativeUiState,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onSelect: (DownloadQualityOption) -> Unit,
) {
    val options = state.qualityOptions[item.id].orEmpty()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Text("Download quality", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Available from this video right now", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            when {
                state.qualityLoadingClassId == item.id -> {
                    Row(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Checking video qualities…")
                    }
                }
                options.isEmpty() -> {
                    EmptyCard("No quality list is loaded yet.")
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = onRefresh, shape = PillShape, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
                }
                else -> options.sortedBy { it.height.takeIf { h -> h > 0 } ?: Int.MAX_VALUE }.forEachIndexed { index, option ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onSelect(option) }.padding(vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(option.label, fontWeight = FontWeight.Bold)
                                if (option.recommended) {
                                    Spacer(Modifier.width(8.dp))
                                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = PillShape) {
                                        Text("Recommended", Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                            val size = if (option.sizeBytes > 0) {
                                (if (option.estimated) "About " else "") + formatBytes(option.sizeBytes)
                            } else "Size calculated when download starts"
                            Text(size, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.Download, null, modifier = Modifier.size(20.dp))
                    }
                    if (index != options.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
private fun DownloadStatusCard(task: SecureDownloadTask) {
    OutlinedCardContainer {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Download, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(task.qualityLabel.ifBlank { if (task.height > 0) "${task.height}p" else "Original quality" }, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text("${task.progress}%", style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.height(10.dp))
            if (task.state != "completed") {
                LinearProgressIndicator(progress = { task.progress / 100f }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
            }
            val phase = when (task.phase) {
                "preparing" -> "Preparing"
                "converting" -> "Preparing offline video"
                "encrypting" -> "Securing video"
                "completed" -> "Offline ready"
                "paused" -> "Paused"
                "failed" -> "Needs attention"
                else -> "Downloading"
            }
            Text(phase, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (task.totalBytes > 0) {
                Text(
                    if (task.state == "completed") formatBytes(task.totalBytes)
                    else "${formatBytes(task.downloadedBytes)} / ${if (task.sizeEstimated) "about " else ""}${formatBytes(task.totalBytes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            task.error?.takeIf { task.state == "failed" }?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun DownloadsScreen(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState) {
    val context = LocalContext.current
    var deleteCandidate by remember { mutableStateOf<SecureDownloadTask?>(null) }
    val active = state.downloads.filter { it.state in setOf("queued", "downloading") }
    val saved = state.downloads.filter { it.state == "completed" }
    val attention = state.downloads.filter { it.state in setOf("paused", "failed") }
    val storedBytes = saved.sumOf { it.totalBytes }

    deleteCandidate?.let { task ->
        DeleteDownloadDialog(task.title, onDismiss = { deleteCandidate = null }) {
            deleteCandidate = null
            viewModel.removeDownload(context, task.id)
        }
    }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Downloads", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Encrypted and playable only inside Easy Education.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            OutlinedCardContainer {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Storage, null)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text("${formatBytes(storedBytes)} saved offline", fontWeight = FontWeight.Bold)
                            Text("${saved.size} classes ready", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 14.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Wi-Fi only downloads", fontWeight = FontWeight.SemiBold)
                            Text(
                                if (state.wifiOnlyDownloads) "Pause new/resumed downloads on mobile data" else "Wi-Fi and mobile data allowed",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(checked = state.wifiOnlyDownloads, onCheckedChange = viewModel::setWifiOnlyDownloads)
                    }
                }
            }
        }

        if (state.downloads.isEmpty()) item { EmptyCard("No offline class yet. Open a class and tap Download.") }

        if (active.isNotEmpty()) {
            item { SectionTitle("Active") }
            items(active, key = { it.id }) { task ->
                DownloadListCard(task, viewModel, state, nav, onDelete = { deleteCandidate = task })
            }
        }
        if (attention.isNotEmpty()) {
            item { SectionTitle("Needs attention") }
            items(attention, key = { it.id }) { task ->
                DownloadListCard(task, viewModel, state, nav, onDelete = { deleteCandidate = task })
            }
        }
        if (saved.isNotEmpty()) {
            item { SectionTitle("Saved offline") }
            items(saved, key = { it.id }) { task ->
                DownloadListCard(task, viewModel, state, nav, onDelete = { deleteCandidate = task })
            }
        }
    }
}

@Composable
private fun DownloadListCard(
    task: SecureDownloadTask,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    nav: NavHostController,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    OutlinedCardContainer {
        Column(Modifier.padding(16.dp)) {
            Text(task.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(task.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            if (task.state != "completed") LinearProgressIndicator(progress = { task.progress / 100f }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(9.dp))
            val quality = task.qualityLabel.ifBlank { if (task.height > 0) "${task.height}p" else "Original" }
            Text(
                "$quality • ${downloadStateLabel(task)}${if (task.totalBytes > 0) " • ${formatBytes(task.totalBytes)}" else ""}",
                style = MaterialTheme.typography.bodySmall,
            )
            task.error?.takeIf { task.state == "failed" }?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                when (task.state) {
                    "completed" -> {
                        Button(
                            onClick = {
                                context.startActivity(
                                    Intent(context, NativePlayerActivity::class.java)
                                        .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, task.id)
                                        .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, task.classId),
                                )
                            },
                            enabled = viewModel.hasOfflineLease(task.courseId),
                            shape = PillShape,
                        ) { Icon(if (viewModel.hasOfflineLease(task.courseId)) Icons.Default.PlayArrow else Icons.Default.Lock, null); Spacer(Modifier.width(5.dp)); Text(if (viewModel.hasOfflineLease(task.courseId)) "Play" else "Verify") }
                        OutlinedButton(onClick = { nav.navigate("class/${task.courseId}/${task.classId}") }, shape = PillShape) { Text("Quality") }
                    }
                    "downloading", "queued" -> OutlinedButton(onClick = { viewModel.pauseDownload(context, task.id) }, shape = PillShape) {
                        Icon(Icons.Default.Pause, null); Spacer(Modifier.width(5.dp)); Text("Pause")
                    }
                    else -> OutlinedButton(
                        onClick = { viewModel.resumeDownload(context, task.id) },
                        enabled = state.online,
                        shape = PillShape,
                    ) { Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(5.dp)); Text("Resume") }
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Delete download", tint = MaterialTheme.colorScheme.error) }
            }
            if (!viewModel.hasOfflineLease(task.courseId) && task.state == "completed") {
                Spacer(Modifier.height(7.dp))
                Text("Connect once to renew the 7-day access check.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ProfileScreen(viewModel: NativeAppViewModel, state: NativeUiState) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        item {
            OutlinedCardContainer {
                Column(Modifier.padding(18.dp)) {
                    Icon(Icons.Default.Person, null, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(10.dp))
                    Text(state.profile?.name?.ifBlank { state.user?.displayName.orEmpty() } ?: "Student", fontWeight = FontWeight.Bold)
                    Text(state.profile?.email?.ifBlank { state.user?.email.orEmpty() } ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            OutlinedCardContainer {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (state.online) Icons.Default.Wifi else Icons.Default.CloudOff, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.online) "Online" else "Offline", fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Downloaded classes use a 7-day offline entitlement lease. Going online renews access automatically.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        item { OutlinedButton(onClick = viewModel::signOut, shape = PillShape, modifier = Modifier.fillMaxWidth()) { Text("Sign out") } }
    }
}

@Composable
private fun DeleteDownloadDialog(title: String, onDismiss: () -> Unit, onDelete: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete offline class?") },
        text = { Text("$title will be removed from this device. You can download it again later.") },
        confirmButton = { TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun BackHeader(nav: NavHostController, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ContentRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null)
            Spacer(Modifier.width(12.dp))
            Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Text("›")
        }
    }
}

@Composable
private fun OutlinedCardContainer(content: @Composable () -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        content = { content() },
    )
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
}

@Composable
private fun EmptyCard(message: String) {
    OutlinedCardContainer { Text(message, Modifier.padding(18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

@Composable
private fun LoadingList(label: String) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = MaterialTheme.typography.titleLarge)
        repeat(5) {
            Box(
                Modifier.fillMaxWidth().height(74.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)),
            )
        }
    }
}

@Composable
private fun LockedOfflineScreen(nav: NavHostController) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        OutlinedCardContainer {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Lock, null, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(12.dp))
                Text("Access verification needed", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Connect once to verify this course and renew offline access.")
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = { nav.popBackStack() }, shape = PillShape) { Text("Back") }
            }
        }
    }
}

private fun downloadStateLabel(task: SecureDownloadTask): String = when (task.state) {
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

private fun formatBytes(value: Long): String = DownloadNotifier.formatBytes(value)
