package com.easyeducation.app

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.filled.ArrowBack
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
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

private data class BottomItem(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val bottomItems = listOf(
    BottomItem("home", "Home", Icons.Default.Home),
    BottomItem("courses", "My Courses", Icons.Default.School),
    BottomItem("downloads", "Downloads", Icons.Default.Download),
    BottomItem("profile", "Profile", Icons.Default.Person),
)

@Composable
fun EasyEducationNativeApp(
    viewModel: NativeAppViewModel,
    onGoogleSignIn: () -> Unit,
    initialPath: String? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                !state.authReady -> NativeSplash()
                state.user == null -> LoginScreen(state.online, onGoogleSignIn)
                else -> {
                    val navController = rememberNavController()
                    val startRoute = if (initialPath == "/downloads") "downloads" else "home"
                    val backStack by navController.currentBackStackEntryAsState()
                    val currentRoute = backStack?.destination?.route.orEmpty()

                    LaunchedEffect(state.error) {
                        val message = state.error ?: return@LaunchedEffect
                        snackbar.showSnackbar(message)
                        viewModel.clearError()
                    }

                    Scaffold(
                        snackbarHost = { SnackbarHost(snackbar) },
                        bottomBar = {
                            NavigationBar {
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
            Icon(Icons.Default.School, null, modifier = Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(16.dp))
            Text("Easy Education", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun LoginScreen(online: Boolean, onGoogleSignIn: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.School, null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(12.dp))
                Text("Easy Education", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Native learning • secure offline classes", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(28.dp))
                Button(
                    onClick = onGoogleSignIn,
                    enabled = online,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Continue with Google")
                }
                if (!online) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.CloudOff, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("First sign-in requires an internet connection.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineBanner() {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.CloudOff, null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Offline mode — cached courses and downloaded classes are available.", style = MaterialTheme.typography.bodySmall)
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
        composable("downloads") { DownloadsScreen(viewModel, state) }
        composable("profile") { ProfileScreen(viewModel, state) }
        composable(
            "course/{courseId}",
            arguments = listOf(navArgument("courseId") { type = NavType.StringType }),
        ) { entry -> CourseScreen(nav, viewModel, state, entry.arguments?.getString("courseId").orEmpty()) }
        composable(
            "subject/{courseId}/{subject}",
            arguments = listOf(
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
            arguments = listOf(
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
            arguments = listOf(
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
    LazyColumn(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
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
            Button(onClick = { nav.navigate("courses") }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.School, null)
                Spacer(Modifier.width(8.dp))
                Text("Open My Courses")
            }
        }
        item {
            OutlinedButton(onClick = { nav.navigate("downloads") }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Download, null)
                Spacer(Modifier.width(8.dp))
                Text("Downloads")
            }
        }
        if (state.online) {
            item {
                TextButton(onClick = { viewModel.refreshOnline() }) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Sync now")
                }
            }
        }
        if (state.courses.isNotEmpty()) {
            item { Text("Continue course", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(state.courses.take(3), key = { it.id }) { course ->
                CourseCard(course) { nav.navigate("course/${course.id}") }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(16.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CoursesScreen(nav: NavHostController, state: NativeUiState) {
    LazyColumn(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("My Courses", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Your enrolled courses are cached for fast access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.courses.isEmpty()) {
            item { EmptyCard("No enrolled course is cached yet. Connect once to sync your account.") }
        } else {
            items(state.courses, key = { it.id }) { course -> CourseCard(course) { nav.navigate("course/${course.id}") } }
        }
    }
}

@Composable
private fun CourseCard(course: NativeCourse, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(58.dp).background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.School, null, tint = MaterialTheme.colorScheme.onPrimaryContainer) }
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
    val leaseValid = state.online || viewModel.hasOfflineLease(courseId)

    if (content == null) {
        LoadingList("Loading course…")
        return
    }
    if (!leaseValid) {
        LockedOfflineScreen(nav)
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { BackHeader(nav, course?.title ?: "Course") }
        if (content.subjects.isNotEmpty()) {
            item { Text("Subjects", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            items(content.subjects, key = { it.id }) { subject ->
                ContentRow(Icons.Default.School, subject.title) {
                    nav.navigate("subject/$courseId/${Uri.encode(subject.title)}")
                }
            }
        } else if (content.chapters.isNotEmpty()) {
            item { Text("Chapters", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            items(content.chapters, key = { it.id }) { chapter ->
                ContentRow(Icons.Default.VideoLibrary, chapter.title) {
                    nav.navigate("chapter/$courseId/${Uri.encode(chapter.subject)}/${Uri.encode(chapter.title)}")
                }
            }
        } else {
            item { Text("Classes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            items(content.classes, key = { it.id }) { item -> ClassRow(item) { nav.navigate("class/$courseId/${item.id}") } }
        }
    }
}

@Composable
private fun SubjectScreen(nav: NavHostController, state: NativeUiState, courseId: String, subject: String) {
    val content = state.courseContent[courseId]
    if (content == null) {
        LoadingList("Loading subject…")
        return
    }
    val chapters = content.chapters.filter {
        it.subject.isBlank() || it.subject.equals(subject, ignoreCase = true)
    }.distinctBy { it.title.lowercase() }
    val classes = content.classes.filter { item -> item.subjects.any { it.equals(subject, true) } }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { BackHeader(nav, subject) }
        if (chapters.isNotEmpty()) {
            items(chapters, key = { it.id }) { chapter ->
                ContentRow(Icons.Default.VideoLibrary, chapter.title) {
                    nav.navigate("chapter/$courseId/${Uri.encode(subject)}/${Uri.encode(chapter.title)}")
                }
            }
        } else {
            items(classes, key = { it.id }) { item -> ClassRow(item) { nav.navigate("class/$courseId/${item.id}") } }
        }
    }
}

@Composable
private fun ChapterScreen(nav: NavHostController, state: NativeUiState, courseId: String, subject: String, chapter: String) {
    val content = state.courseContent[courseId]
    if (content == null) {
        LoadingList("Loading chapter…")
        return
    }
    val classes = content.classes.filter { item ->
        item.chapters.any { it.equals(chapter, true) } &&
            (subject.isBlank() || item.subjects.isEmpty() || item.subjects.any { it.equals(subject, true) })
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { BackHeader(nav, chapter) }
        if (classes.isEmpty()) item { EmptyCard("No class is cached for this chapter yet.") }
        items(classes, key = { it.id }) { item -> ClassRow(item) { nav.navigate("class/$courseId/${item.id}") } }
    }
}

@Composable
private fun ClassRow(item: NativeClassItem, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(46.dp).background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(12.dp)),
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
    var quality by remember { mutableIntStateOf(task?.height ?: 480) }

    if (item == null || course == null) {
        LoadingList("Loading class…")
        return
    }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { BackHeader(nav, "Class") }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Icon(Icons.Default.VideoLibrary, null, modifier = Modifier.size(42.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(12.dp))
                    Text(item.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    if (item.teacherName.isNotBlank()) Text(item.teacherName, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.duration.isNotBlank()) Text(item.duration, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (task?.state == "completed") {
            item {
                Button(
                    onClick = {
                        if (viewModel.hasOfflineLease(courseId)) {
                            context.startActivity(
                                Intent(context, NativePlayerActivity::class.java)
                                    .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, task.id)
                                    .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, item.id),
                            )
                        }
                    },
                    enabled = viewModel.hasOfflineLease(courseId),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.PlayArrow, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (viewModel.hasOfflineLease(courseId)) "Play Offline" else "Connect to verify access")
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
                            .putExtra(NativePlayerActivity.EXTRA_HEIGHT, quality),
                    )
                },
                enabled = state.online && item.sourceUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(if (state.online) Icons.Default.PlayArrow else Icons.Default.CloudOff, null)
                Spacer(Modifier.width(8.dp))
                Text("Watch Online")
            }
        }
        item {
            Text("Download quality", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(360, 480, 720).forEach { height ->
                    AssistChip(
                        onClick = { quality = height },
                        label = { Text(if (height == 360) "360p Data Saver" else "${height}p") },
                        leadingIcon = if (quality == height) {{ Icon(Icons.Default.Download, null, Modifier.size(16.dp)) }} else null,
                    )
                }
            }
        }
        item {
            when (task?.state) {
                "downloading", "queued" -> {
                    Column {
                        LinearProgressIndicator(progress = { task.progress / 100f }, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { viewModel.pauseDownload(context, task.id) }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Pause, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Pause download • ${task.progress}%")
                        }
                    }
                }
                "paused", "failed" -> OutlinedButton(
                    onClick = { viewModel.resumeDownload(context, task.id) },
                    enabled = state.online,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (task.state == "failed") "Retry Download" else "Resume Download")
                }
                "completed" -> Text("Encrypted offline copy is ready.", color = MaterialTheme.colorScheme.primary)
                else -> Button(
                    onClick = { viewModel.startDownload(context, course, item, quality) },
                    enabled = state.online,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.Download, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Download for Offline")
                }
            }
        }
    }
}

@Composable
private fun DownloadsScreen(viewModel: NativeAppViewModel, state: NativeUiState) {
    val context = LocalContext.current
    LaunchedEffect(state.user?.uid) {
        while (true) {
            viewModel.refreshDownloads()
            delay(1000)
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Downloads", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Encrypted and playable only inside Easy Education.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.downloads.isEmpty()) item { EmptyCard("No offline class yet. Open a class and tap Download for Offline.") }
        items(state.downloads, key = { it.id }) { task ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(task.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(task.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(10.dp))
                    if (task.state != "completed") LinearProgressIndicator(progress = { task.progress / 100f }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(10.dp))
                    Text("${task.height}p • ${task.state.replaceFirstChar { it.uppercase() }}${if (task.totalBytes > 0) " • ${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}" else ""}")
                    task.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        when (task.state) {
                            "completed" -> Button(
                                onClick = {
                                    context.startActivity(
                                        Intent(context, NativePlayerActivity::class.java)
                                            .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, task.id)
                                            .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, task.classId),
                                    )
                                },
                                enabled = viewModel.hasOfflineLease(task.courseId),
                            ) {
                                Icon(if (viewModel.hasOfflineLease(task.courseId)) Icons.Default.PlayArrow else Icons.Default.Lock, null)
                                Spacer(Modifier.width(5.dp))
                                Text(if (viewModel.hasOfflineLease(task.courseId)) "Play" else "Verify access")
                            }
                            "downloading", "queued" -> OutlinedButton(onClick = { viewModel.pauseDownload(context, task.id) }) {
                                Icon(Icons.Default.Pause, null)
                                Text(" Pause")
                            }
                            else -> OutlinedButton(
                                onClick = { viewModel.resumeDownload(context, task.id) },
                                enabled = state.online,
                            ) {
                                Icon(Icons.Default.Refresh, null)
                                Text(" Resume")
                            }
                        }
                        IconButton(onClick = { viewModel.removeDownload(context, task.id) }) {
                            Icon(Icons.Default.Delete, "Delete download", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    if (!viewModel.hasOfflineLease(task.courseId) && task.state == "completed") {
                        Text(
                            "Connect once to renew the 7-day offline access check.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileScreen(viewModel: NativeAppViewModel, state: NativeUiState) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Text("Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Icon(Icons.Default.Person, null, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(10.dp))
                    Text(state.profile?.name?.ifBlank { state.user?.displayName.orEmpty() } ?: "Student", fontWeight = FontWeight.Bold)
                    Text(state.profile?.email?.ifBlank { state.user?.email.orEmpty() } ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Card(Modifier.fillMaxWidth()) {
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
        item {
            OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        }
    }
}

@Composable
private fun BackHeader(nav: NavHostController, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.Default.ArrowBack, "Back") }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ContentRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null)
            Spacer(Modifier.width(12.dp))
            Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Text("›")
        }
    }
}

@Composable
private fun EmptyCard(message: String) {
    Card(Modifier.fillMaxWidth()) { Text(message, Modifier.padding(18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

@Composable
private fun LoadingList(label: String) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = MaterialTheme.typography.titleLarge)
        repeat(5) {
            Box(
                Modifier.fillMaxWidth().height(74.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp)),
            )
        }
    }
}

@Composable
private fun LockedOfflineScreen(nav: NavHostController) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Card {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Lock, null, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(12.dp))
                Text("Access verification needed", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Connect to the internet once to verify this course and renew offline access.")
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = { nav.popBackStack() }) { Text("Back") }
            }
        }
    }
}

private fun formatBytes(value: Long): String = when {
    value >= 1024L * 1024L * 1024L -> "%.1f GB".format(value / (1024.0 * 1024.0 * 1024.0))
    value >= 1024L * 1024L -> "%.1f MB".format(value / (1024.0 * 1024.0))
    value >= 1024L -> "%.1f KB".format(value / 1024.0)
    else -> "$value B"
}
