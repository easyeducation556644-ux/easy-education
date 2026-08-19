@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
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
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
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
import coil.compose.AsyncImage

private data class V2BottomItem(
    val route: String,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private val v2BottomItems = listOf(
    V2BottomItem("home", "Home", Icons.Default.Home),
    V2BottomItem("courses", "My Courses", Icons.Default.School),
    V2BottomItem("downloads", "Downloads", Icons.Default.Download),
    V2BottomItem("profile", "Profile", Icons.Default.Person),
)
private val V2Pill = RoundedCornerShape(999.dp)
private const val WEB_ORIGIN = "https://easy-education.vercel.app"
private const val CLASS_ROUTE = "class/{courseId}/{classId}"

@Composable
fun EasyEducationNativeAppV2(
    viewModel: NativeAppViewModel,
    onGoogleSignIn: () -> Unit,
    loginBusy: Boolean = false,
    activeDeviceCount: Int = 0,
    initialPath: String? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var themeMode by rememberSaveable { mutableStateOf(NativeThemePreferences.mode(context)) }
    val snackbar = remember { SnackbarHostState() }

    EasyEducationTheme(themeMode) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                !state.authReady -> V2Splash()
                state.user == null -> V2LoginScreen(state.online, loginBusy, onGoogleSignIn)
                else -> {
                    val nav = rememberNavController()
                    val startRoute = if (initialPath == "/downloads") "downloads" else "home"
                    val backStack by nav.currentBackStackEntryAsState()
                    val currentRoute = backStack?.destination?.route.orEmpty()
                    val isWatchRoute = currentRoute.startsWith("class/")

                    LaunchedEffect(state.error) {
                        state.error?.let { raw ->
                            snackbar.showSnackbar(friendlyUiError(raw, state.online))
                            viewModel.clearError()
                        }
                    }

                    Scaffold(
                        snackbarHost = { SnackbarHost(snackbar) },
                        containerColor = MaterialTheme.colorScheme.background,
                        bottomBar = {
                            if (!isWatchRoute) {
                                NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                                    v2BottomItems.forEach { item ->
                                        val selected = currentRoute == item.route ||
                                            (item.route == "courses" && currentRoute.inCourseRoutes())
                                        NavigationBarItem(
                                            selected = selected,
                                            onClick = {
                                                nav.navigate(item.route) {
                                                    launchSingleTop = true
                                                    restoreState = true
                                                    popUpTo("home") { saveState = true }
                                                }
                                            },
                                            icon = { Icon(item.icon, item.label) },
                                            label = { Text(item.label) },
                                        )
                                    }
                                }
                            }
                        },
                    ) { padding ->
                        Column(Modifier.fillMaxSize().padding(padding)) {
                            if (!state.online && !isWatchRoute) V2OfflineBanner()
                            if (state.syncing) LinearProgressIndicator(Modifier.fillMaxWidth())
                            V2NavHost(
                                nav = nav,
                                viewModel = viewModel,
                                state = state,
                                startRoute = startRoute,
                                themeMode = themeMode,
                                onThemeMode = { mode ->
                                    NativeThemePreferences.setMode(context, mode)
                                    themeMode = mode
                                },
                                activeDeviceCount = activeDeviceCount,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/")

@Composable
private fun V2Splash() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primary) {
                Icon(Icons.Default.School, null, Modifier.padding(18.dp).size(38.dp), tint = MaterialTheme.colorScheme.onPrimary)
            }
            Spacer(Modifier.height(14.dp))
            Text("Easy Education", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            CircularProgressIndicator(strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun V2LoginScreen(online: Boolean, busy: Boolean, onGoogleSignIn: () -> Unit) {
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().padding(22.dp), contentAlignment = Alignment.Center) {
        V2OutlinedCard {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primary) {
                    Icon(Icons.Default.School, null, Modifier.padding(16.dp).size(34.dp), tint = MaterialTheme.colorScheme.onPrimary)
                }
                Spacer(Modifier.height(14.dp))
                Text("Easy Education", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Learn anywhere. Save classes securely.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = onGoogleSignIn,
                    enabled = online && !busy,
                    shape = V2Pill,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(9.dp))
                        Text("Signing in…")
                    } else {
                        Text("Continue with Google")
                    }
                }
                Spacer(Modifier.height(10.dp))
                TextButton(onClick = { openWeb(context, "$WEB_ORIGIN/courses") }) {
                    Icon(Icons.Default.Language, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("Browse courses on web")
                }
                if (!online) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "No internet connection. Connect to sign in; saved classes will work after your first login.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun V2OfflineBanner() {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.CloudOff, null, Modifier.size(17.dp))
        Spacer(Modifier.width(8.dp))
        Text("No internet • showing saved and cached content", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun V2NavHost(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    startRoute: String,
    themeMode: String,
    onThemeMode: (String) -> Unit,
    activeDeviceCount: Int,
) {
    NavHost(
        navController = nav,
        startDestination = startRoute,
        modifier = Modifier.fillMaxSize(),
        enterTransition = {
            fadeIn(animationSpec = tween(170)) +
                slideInHorizontally(animationSpec = tween(220)) { fullWidth -> fullWidth / 16 }
        },
        exitTransition = {
            fadeOut(animationSpec = tween(120)) +
                slideOutHorizontally(animationSpec = tween(170)) { fullWidth -> -fullWidth / 30 }
        },
        popEnterTransition = {
            if (initialState.destination.route == CLASS_ROUTE) {
                EnterTransition.None
            } else {
                fadeIn(animationSpec = tween(170)) +
                    slideInHorizontally(animationSpec = tween(220)) { fullWidth -> -fullWidth / 16 }
            }
        },
        popExitTransition = {
            if (initialState.destination.route == CLASS_ROUTE) {
                ExitTransition.None
            } else {
                fadeOut(animationSpec = tween(120)) +
                    slideOutHorizontally(animationSpec = tween(170)) { fullWidth -> fullWidth / 30 }
            }
        },
    ) {
        composable("home") { V2Home(nav, viewModel, state) }
        composable("courses") { V2Courses(nav, state) }
        composable("downloads") { V2Downloads(viewModel, state) }
        composable("profile") { V2Profile(viewModel, state, themeMode, onThemeMode, activeDeviceCount) }
        composable("course/{courseId}", listOf(navArgument("courseId") { type = NavType.StringType })) { entry ->
            V2Course(nav, viewModel, state, entry.arguments?.getString("courseId").orEmpty())
        }
        composable(
            "subject/{courseId}/{subject}",
            listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("subject") { type = NavType.StringType }),
        ) { entry ->
            V2Subject(nav, state, entry.arguments?.getString("courseId").orEmpty(), Uri.decode(entry.arguments?.getString("subject").orEmpty()))
        }
        composable(
            "chapter/{courseId}/{subject}/{chapter}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("subject") { type = NavType.StringType },
                navArgument("chapter") { type = NavType.StringType },
            ),
        ) { entry ->
            V2Chapter(
                nav,
                state,
                entry.arguments?.getString("courseId").orEmpty(),
                Uri.decode(entry.arguments?.getString("subject").orEmpty()),
                Uri.decode(entry.arguments?.getString("chapter").orEmpty()),
            )
        }
        composable(
            "class/{courseId}/{classId}",
            listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("classId") { type = NavType.StringType }),
        ) { entry ->
            YoutubeClassWatchPage(
                nav = nav,
                viewModel = viewModel,
                state = state,
                courseId = entry.arguments?.getString("courseId").orEmpty(),
                classId = entry.arguments?.getString("classId").orEmpty(),
            )
        }
    }
}

@Composable
private fun V2Home(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState) {
    val context = LocalContext.current
    val ready = state.downloads.count { it.state == "completed" }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Text("Hi ${state.profile?.name?.substringBefore(' ')?.ifBlank { "Student" } ?: "Student"}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Continue where you left off.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                V2Stat("My courses", state.courses.size.toString(), Modifier.weight(1f))
                V2Stat("Offline ready", ready.toString(), Modifier.weight(1f))
            }
        }
        item {
            Button(onClick = { nav.navigate("courses") }, modifier = Modifier.fillMaxWidth(), shape = V2Pill) {
                Icon(Icons.Default.School, null); Spacer(Modifier.width(8.dp)); Text("Open My Courses")
            }
        }
        item {
            OutlinedButton(onClick = { openWeb(context, "$WEB_ORIGIN/courses") }, modifier = Modifier.fillMaxWidth(), shape = V2Pill) {
                Icon(Icons.Default.Language, null); Spacer(Modifier.width(8.dp)); Text("Browse & buy courses")
            }
            Text(
                "Purchases are securely managed on the Easy Education website. Return here and tap Sync after enrollment.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        if (state.online) item {
            TextButton(onClick = { viewModel.refreshOnline() }) {
                Icon(Icons.Default.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Sync now")
            }
        }
        if (state.courses.isNotEmpty()) {
            item { V2Section("Continue learning") }
            items(state.courses.take(4), key = { it.id }) { course -> V2CourseCard(course) { nav.navigate("course/${course.id}") } }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2Stat(label: String, value: String, modifier: Modifier) {
    Card(modifier, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(15.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun V2Courses(nav: NavHostController, state: NativeUiState) {
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("My Courses", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Enrolled courses", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { openWeb(context, "$WEB_ORIGIN/courses") }) { Text("Buy courses") }
            }
        }
        if (state.courses.isEmpty()) {
            item {
                V2OutlinedCard {
                    Column(Modifier.padding(18.dp)) {
                        Text("No enrolled course is synced yet.", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { openWeb(context, "$WEB_ORIGIN/courses") }, shape = V2Pill) { Text("Browse courses") }
                    }
                }
            }
        } else items(state.courses, key = { it.id }) { course -> V2CourseCard(course) { nav.navigate("course/${course.id}") } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2CourseCard(course: NativeCourse, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column {
            if (course.thumbnailUrl.isNotBlank()) {
                AsyncImage(
                    model = course.thumbnailUrl,
                    contentDescription = course.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f),
                )
            }
            Column(Modifier.padding(14.dp)) {
                Text(course.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (course.description.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(course.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun V2Course(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState, courseId: String) {
    val context = LocalContext.current
    LaunchedEffect(courseId) { viewModel.loadCourse(courseId) }
    val content = state.courseContent[courseId]
    if (content == null) { V2Loading("Loading course…"); return }
    if (!(state.online || viewModel.hasOfflineLease(courseId))) { V2Locked(nav); return }
    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, course?.title ?: "Course") }
        course?.thumbnailUrl?.takeIf { it.isNotBlank() }?.let { image ->
            item { AsyncImage(image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f).clip(RoundedCornerShape(14.dp))) }
        }
        when {
            content.subjects.isNotEmpty() -> {
                item { V2Section("Subjects") }
                items(content.subjects, key = { it.id }) { subject ->
                    V2LearningRow(subject.title, subject.imageUrl, Icons.Default.School) { nav.navigate("subject/$courseId/${Uri.encode(subject.title)}") }
                }
            }
            content.chapters.isNotEmpty() -> {
                item { V2Section("Chapters") }
                items(content.chapters, key = { it.id }) { chapter ->
                    V2LearningRow(chapter.title, chapter.imageUrl, Icons.Default.VideoLibrary) {
                        nav.navigate("chapter/$courseId/${Uri.encode(chapter.subject)}/${Uri.encode(chapter.title)}")
                    }
                }
            }
            else -> {
                item { V2Section("Classes") }
                items(content.classes, key = { it.id }) { classItem ->
                    V2ClassRow(classItem) { openClass(context, nav, courseId, classItem.id) }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2Subject(nav: NavHostController, state: NativeUiState, courseId: String, subject: String) {
    val context = LocalContext.current
    val content = state.courseContent[courseId] ?: run { V2Loading("Loading subject…"); return }
    val chapters = content.chapters.filter { it.subject.isBlank() || it.subject.equals(subject, true) }.distinctBy { it.title.lowercase() }
    val classes = content.classes.filter { classItem -> classItem.subjects.isEmpty() || classItem.subjects.any { it.equals(subject, true) } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, subject) }
        if (chapters.isNotEmpty()) {
            item { V2Section("Chapters") }
            items(chapters, key = { it.id }) { chapter ->
                V2LearningRow(chapter.title, chapter.imageUrl, Icons.Default.VideoLibrary) {
                    nav.navigate("chapter/$courseId/${Uri.encode(subject)}/${Uri.encode(chapter.title)}")
                }
            }
        } else {
            item { V2Section("Classes") }
            items(classes, key = { it.id }) { classItem ->
                V2ClassRow(classItem) { openClass(context, nav, courseId, classItem.id) }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2Chapter(nav: NavHostController, state: NativeUiState, courseId: String, subject: String, chapter: String) {
    val context = LocalContext.current
    val content = state.courseContent[courseId] ?: run { V2Loading("Loading chapter…"); return }
    val classes = content.classes.filter { classItem ->
        classItem.chapters.any { it.equals(chapter, true) } &&
            (subject.isBlank() || classItem.subjects.isEmpty() || classItem.subjects.any { it.equals(subject, true) })
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, chapter) }
        item { V2Section("Classes") }
        if (classes.isEmpty()) item { V2Empty("No classes are available in this chapter yet.") }
        else items(classes, key = { it.id }) { classItem ->
            V2ClassRow(classItem) {
                PersistentNativePlayer.prefetch(context, classItem.id, classItem.sourceUrl, 480)
                openClass(context, nav, courseId, classItem.id)
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

private fun openClass(context: Context, nav: NavHostController, courseId: String, classId: String) {
    NativeWatchBackdrop.capture(context)
    nav.navigate("class/$courseId/$classId")
}

@Composable
private fun V2LearningRow(title: String, imageUrl: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(13.dp),
    ) {
        Row(Modifier.padding(9.dp), verticalAlignment = Alignment.CenterVertically) {
            V2Thumbnail(imageUrl, icon, Modifier.size(72.dp))
            Spacer(Modifier.width(12.dp))
            Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("›", style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun V2ClassRow(classItem: NativeClassItem, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(13.dp),
    ) {
        Row(Modifier.padding(9.dp), verticalAlignment = Alignment.CenterVertically) {
            V2Thumbnail(classItem.imageUrl, Icons.Default.PlayArrow, Modifier.width(102.dp).height(66.dp))
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(classItem.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOf(classItem.teacherName, classItem.duration).filter { it.isNotBlank() }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (classItem.resourceLinks.isNotEmpty()) {
                    Text(
                        "Resources: " + classItem.resourceLinks.take(3).joinToString(" • ") { it.label },
                        style = MaterialTheme.typography.labelSmall,
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
private fun V2Thumbnail(imageUrl: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) {
    if (imageUrl.isNotBlank()) {
        AsyncImage(imageUrl, null, contentScale = ContentScale.Crop, modifier = modifier.clip(RoundedCornerShape(10.dp)))
    } else {
        Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(28.dp))
        }
    }
}

@Composable
private fun V2Downloads(viewModel: NativeAppViewModel, state: NativeUiState) {
    val context = LocalContext.current
    var deleteId by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(6.dp)); Text("Downloads", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Wifi, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text("Wi-Fi only", fontWeight = FontWeight.SemiBold)
                    Text("Pause mobile-data downloads", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = state.wifiOnlyDownloads, onCheckedChange = viewModel::setWifiOnlyDownloads)
            }
        }
        if (state.downloads.isEmpty()) item { V2Empty("No offline classes yet. Open a class and tap the compact Download button.") }
        else items(state.downloads, key = { it.id }) { task ->
            Card(
                Modifier.fillMaxWidth(),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(task.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(task.courseTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${task.qualityLabel.ifBlank { "${task.height}p" }} • ${v2DownloadState(task)}", style = MaterialTheme.typography.bodySmall)
                    if (task.state in setOf("queued", "downloading")) LinearProgressIndicator(progress = { task.progress / 100f }, modifier = Modifier.fillMaxWidth())
                    task.error?.takeIf { it.isNotBlank() }?.let { Text(friendlyUiError(it, state.online), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        when (task.state) {
                            "completed" -> Button(
                                onClick = {
                                    context.startActivity(
                                        Intent(context, NativePlayerActivity::class.java)
                                            .putExtra(NativePlayerActivity.EXTRA_DOWNLOAD_ID, task.id)
                                            .putExtra(NativePlayerActivity.EXTRA_CLASS_ID, task.classId)
                                            .putExtra(NativePlayerActivity.EXTRA_TITLE, task.title),
                                    )
                                },
                                enabled = viewModel.hasOfflineLease(task.courseId),
                                shape = V2Pill,
                            ) { Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(5.dp)); Text("Play") }
                            "downloading", "queued" -> OutlinedButton(onClick = { viewModel.pauseDownload(context, task.id) }, shape = V2Pill) { Icon(Icons.Default.Pause, null); Spacer(Modifier.width(5.dp)); Text("Pause") }
                            else -> OutlinedButton(onClick = { viewModel.resumeDownload(context, task.id) }, shape = V2Pill) { Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(5.dp)); Text("Resume") }
                        }
                        IconButton(onClick = { deleteId = task.id }) { Icon(Icons.Default.Delete, "Delete") }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
    deleteId?.let { id ->
        AlertDialog(
            onDismissRequest = { deleteId = null },
            title = { Text("Delete download?") },
            text = { Text("The encrypted offline file and temporary data will be removed.") },
            confirmButton = { TextButton(onClick = { viewModel.removeDownload(context, id); deleteId = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleteId = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun V2Profile(
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    themeMode: String,
    onThemeMode: (String) -> Unit,
    activeDeviceCount: Int,
) {
    val context = LocalContext.current
    val profilePhoto = state.profile?.photoUrl.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)); Text("Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        item {
            V2OutlinedCard {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (profilePhoto.isNotBlank()) {
                        AsyncImage(profilePhoto, null, contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp).clip(CircleShape))
                    } else {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) { Icon(Icons.Default.Person, null, Modifier.padding(14.dp).size(28.dp)) }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(state.profile?.name?.ifBlank { state.user?.displayName ?: "Student" } ?: "Student", fontWeight = FontWeight.Bold)
                        Text(state.profile?.email?.ifBlank { state.user?.email.orEmpty() }.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Active devices: ${activeDeviceCount.takeIf { it > 0 } ?: state.profile?.deviceCount ?: 1}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item {
            V2OutlinedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Palette, null); Spacer(Modifier.width(8.dp)); Text("Appearance", fontWeight = FontWeight.Bold) }
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        ThemeChoice("System", NativeThemePreferences.SYSTEM, themeMode, onThemeMode, Modifier.weight(1f))
                        ThemeChoice("Light", NativeThemePreferences.LIGHT, themeMode, onThemeMode, Modifier.weight(1f))
                        ThemeChoice("Dark", NativeThemePreferences.DARK, themeMode, onThemeMode, Modifier.weight(1f))
                    }
                }
            }
        }
        item {
            V2OutlinedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Course access", fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = { openWeb(context, "$WEB_ORIGIN/courses") }, modifier = Modifier.fillMaxWidth(), shape = V2Pill) {
                        Icon(Icons.Default.Language, null, Modifier.size(18.dp)); Spacer(Modifier.width(7.dp)); Text("Browse & buy courses")
                    }
                }
            }
        }
        item { OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth(), shape = V2Pill) { Text("Sign out") } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun ThemeChoice(label: String, mode: String, selected: String, onSelect: (String) -> Unit, modifier: Modifier) {
    if (mode == selected) Button(onClick = { onSelect(mode) }, modifier = modifier, shape = V2Pill) { Text(label) }
    else OutlinedButton(onClick = { onSelect(mode) }, modifier = modifier, shape = V2Pill) { Text(label) }
}

@Composable
private fun V2Back(nav: NavHostController, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun V2OutlinedCard(content: @Composable () -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
        content = { content() },
    )
}

@Composable
private fun V2Section(text: String) { Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }

@Composable
private fun V2Empty(message: String) { V2OutlinedCard { Text(message, Modifier.padding(18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) } }

@Composable
private fun V2Loading(label: String) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        Text(label, style = MaterialTheme.typography.titleLarge)
        repeat(5) { Box(Modifier.fillMaxWidth().height(76.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(13.dp))) }
    }
}

@Composable
private fun V2Locked(nav: NavHostController) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        V2OutlinedCard {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Lock, null, Modifier.size(42.dp)); Spacer(Modifier.height(10.dp))
                Text("Access verification needed", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp)); Text("Connect once to verify this course and renew offline access.")
                Spacer(Modifier.height(14.dp)); OutlinedButton(onClick = { nav.popBackStack() }, shape = V2Pill) { Text("Back") }
            }
        }
    }
}

private fun friendlyUiError(raw: String, online: Boolean): String {
    if (!online) return "No internet connection. Showing saved content where available."
    val value = raw.trim()
    return when {
        value.contains("Failed to load", true) ||
            value.contains("Unable to resolve host", true) ||
            value.contains("Failed to connect", true) ||
            value.contains("timeout", true) ||
            value.contains("easy-education.vercel.app", true) -> "Network problem. Check your internet connection and try again."
        value.isBlank() -> "Something went wrong. Please try again."
        else -> value
    }
}

private fun v2DownloadState(task: SecureDownloadTask): String = when (task.state) {
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

private fun openWeb(context: android.content.Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}
