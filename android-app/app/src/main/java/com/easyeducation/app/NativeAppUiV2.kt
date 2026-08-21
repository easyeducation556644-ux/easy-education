@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.togetherWith
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhoneAndroid
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
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil

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
private const val PAST_CLASS_PAGE_SIZE = 5
private const val APP_MOTION_QUICK_MS = 150
private const val APP_MOTION_STANDARD_MS = 240
private const val APP_MOTION_EMPHASIZED_MS = 320
private const val COURSE_STORE_BRIDGE = "EasyEducationNative"

private class NativeCourseStoreBridge(
    private val onMyCourses: () -> Unit,
    private val onCheckoutComplete: () -> Unit,
) {
    @JavascriptInterface
    fun openMyCourses() = onMyCourses()

    @JavascriptInterface
    fun checkoutComplete() = onCheckoutComplete()
}

private val COURSE_STORE_BRIDGE_SCRIPT = """
    (function () {
      if (window.__easyEducationNativeBridgeInstalled) return;
      window.__easyEducationNativeBridgeInstalled = true;
      function notifyNative() {
        if (!window.EasyEducationNative) return;
        if (window.location.pathname === '/my-courses') {
          window.EasyEducationNative.openMyCourses();
        } else if (window.location.pathname === '/checkout-complete') {
          window.EasyEducationNative.checkoutComplete();
        }
      }
      var pushState = history.pushState;
      history.pushState = function () {
        var result = pushState.apply(this, arguments);
        setTimeout(notifyNative, 0);
        return result;
      };
      var replaceState = history.replaceState;
      history.replaceState = function () {
        var result = replaceState.apply(this, arguments);
        setTimeout(notifyNative, 0);
        return result;
      };
      var nativeFetch = window.fetch.bind(window);
      window.fetch = function () {
        var args = arguments;
        return nativeFetch.apply(window, args).then(function (response) {
          try {
            var input = args[0];
            var requestUrl = String((input && input.url) || input || '');
            if (requestUrl.indexOf('/api/process-enrollment') !== -1 && response.ok) {
              response.clone().json().then(function (payload) {
                if (payload && payload.success && window.EasyEducationNative) {
                  window.EasyEducationNative.checkoutComplete();
                }
              }).catch(function () {});
            }
          } catch (ignored) {}
          return response;
        });
      };
      window.addEventListener('popstate', notifyNative);
      notifyNative();
    })();
""".trimIndent()

@Composable
fun EasyEducationNativeAppV2(
    viewModel: NativeAppViewModel,
    onGoogleSignIn: () -> Unit,
    loginBusy: Boolean = false,
    activeDevices: List<NativeActiveDevice> = emptyList(),
    initialPath: String? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var themeMode by rememberSaveable { mutableStateOf(NativeThemePreferences.mode(context)) }
    val snackbar = remember { SnackbarHostState() }

    EasyEducationTheme(themeMode) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            val rootDestination = when {
                !state.authReady -> "splash"
                state.user == null -> "login"
                else -> "app"
            }
            AnimatedContent(
                targetState = rootDestination,
                transitionSpec = {
                    (fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS)) +
                        scaleIn(initialScale = 0.985f, animationSpec = tween(APP_MOTION_EMPHASIZED_MS))) togetherWith
                        (fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)) +
                            scaleOut(targetScale = 1.01f, animationSpec = tween(APP_MOTION_QUICK_MS)))
                },
                label = "app destination",
            ) { destination ->
                when (destination) {
                    "splash" -> V2Splash()
                    "login" -> V2LoginScreen(state.online, loginBusy, onGoogleSignIn)
                    else -> {
                    val nav = rememberNavController()
                    val startRoute = nativeStartRoute(initialPath)
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
                            AnimatedVisibility(
                                visible = !isWatchRoute,
                                enter = slideInVertically(animationSpec = tween(APP_MOTION_STANDARD_MS)) { it } +
                                    fadeIn(animationSpec = tween(APP_MOTION_QUICK_MS)),
                                exit = slideOutVertically(animationSpec = tween(APP_MOTION_STANDARD_MS)) { it } +
                                    fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)),
                            ) {
                                NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                                    v2BottomItems.forEach { item ->
                                        val selected = currentRoute == item.route ||
                                            (item.route == "courses" && currentRoute.inCourseRoutes())
                                        NavigationBarItem(
                                            selected = selected,
                                            onClick = {
                                                if (item.route == "home") {
                                                    nav.navigateHome(currentRoute)
                                                } else {
                                                    nav.navigate(item.route) {
                                                        launchSingleTop = true
                                                        restoreState = true
                                                        popUpTo("home") { saveState = true }
                                                    }
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
                            AnimatedVisibility(
                                visible = !state.online && !isWatchRoute,
                                enter = slideInVertically(animationSpec = tween(APP_MOTION_STANDARD_MS)) { -it } +
                                    fadeIn(animationSpec = tween(APP_MOTION_QUICK_MS)),
                                exit = slideOutVertically(animationSpec = tween(APP_MOTION_STANDARD_MS)) { -it } +
                                    fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)),
                            ) { V2OfflineBanner() }
                            AnimatedVisibility(
                                visible = state.syncing,
                                enter = fadeIn(animationSpec = tween(APP_MOTION_QUICK_MS)),
                                exit = fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)),
                            ) { LinearProgressIndicator(Modifier.fillMaxWidth()) }
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
                                activeDevices = activeDevices,
                            )
                        }
                    }
                    }
                }
            }
        }
    }
}

private fun NavHostController.navigateHome(currentRoute: String) {
    if (currentRoute == "home") return
    if (popBackStack("home", inclusive = false)) return
    navigate("home") {
        popUpTo(graph.startDestinationId) {
            inclusive = true
            saveState = false
        }
        launchSingleTop = true
        restoreState = false
    }
}

private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/") ||
        startsWith("archive/") || startsWith("archive-chapter/") || startsWith("past-classes")

private fun nativeStartRoute(initialPath: String?): String {
    val path = initialPath?.trim().orEmpty()
    if (path.isBlank()) return "home"
    val segments = runCatching { Uri.parse(path).pathSegments }.getOrDefault(emptyList())
    return when {
        path == "/downloads" || segments.firstOrNull() == "downloads" -> "downloads"
        segments.firstOrNull() == "my-courses" -> "courses"
        segments.size >= 4 && segments[0] == "course" && segments[2] == "watch" ->
            "class/${Uri.encode(segments[1])}/${Uri.encode(segments[3])}"
        else -> "home"
    }
}

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
    activeDevices: List<NativeActiveDevice>,
) {
    NavHost(
        navController = nav,
        startDestination = startRoute,
        modifier = Modifier.fillMaxSize(),
        enterTransition = {
            if (targetState.destination.route == CLASS_ROUTE) EnterTransition.None
            else fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS)) +
                slideInHorizontally(animationSpec = tween(APP_MOTION_EMPHASIZED_MS)) { fullWidth -> fullWidth / 16 }
        },
        exitTransition = {
            if (targetState.destination.route == CLASS_ROUTE) ExitTransition.None
            else fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)) +
                slideOutHorizontally(animationSpec = tween(APP_MOTION_STANDARD_MS)) { fullWidth -> -fullWidth / 30 }
        },
        popEnterTransition = {
            if (initialState.destination.route == CLASS_ROUTE) EnterTransition.None
            else fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS)) +
                slideInHorizontally(animationSpec = tween(APP_MOTION_EMPHASIZED_MS)) { fullWidth -> -fullWidth / 16 }
        },
        popExitTransition = {
            if (initialState.destination.route == CLASS_ROUTE) ExitTransition.None
            else fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)) +
                slideOutHorizontally(animationSpec = tween(APP_MOTION_STANDARD_MS)) { fullWidth -> fullWidth / 30 }
        },
    ) {
        composable("home") { V2Home(nav, viewModel, state) }
        composable("courses") { V2Courses(nav, state) }
        composable("downloads") { V2Downloads(viewModel, state) }
        composable("profile") { V2Profile(nav, viewModel, state, themeMode, onThemeMode, activeDevices) }
        composable("past-classes") { V2PastCourses(nav, viewModel, state) }
        composable(
            "past-classes/{courseId}",
            listOf(navArgument("courseId") { type = NavType.StringType }),
        ) { entry ->
            V2PastClassPage(nav, viewModel, state, entry.arguments?.getString("courseId").orEmpty())
        }
        composable("add-course") { V2AddCourse(nav, viewModel, state) }
        composable("course/{courseId}", listOf(navArgument("courseId") { type = NavType.StringType })) { entry ->
            V2Course(nav, viewModel, state, entry.arguments?.getString("courseId").orEmpty())
        }
        composable(
            "archive/{courseId}",
            listOf(navArgument("courseId") { type = NavType.StringType }),
        ) { entry ->
            NativeArchiveCourseScreen(nav, state, entry.arguments?.getString("courseId").orEmpty())
        }
        composable(
            "archive-chapter/{courseId}/{subject}/{chapter}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("subject") { type = NavType.StringType },
                navArgument("chapter") { type = NavType.StringType },
            ),
        ) { entry ->
            NativeArchiveChapterScreen(
                nav = nav,
                state = state,
                courseId = entry.arguments?.getString("courseId").orEmpty(),
                subject = Uri.decode(entry.arguments?.getString("subject").orEmpty()),
                chapter = Uri.decode(entry.arguments?.getString("chapter").orEmpty()),
            )
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
    LaunchedEffect(state.courses.map { it.id }) {
        state.courses.take(4).forEach { course -> viewModel.loadCourse(course.id) }
    }
    val cachedClasses = state.courseContent.values
        .flatMap { it.classes }
        .filterNot { it.isArchived }
        .distinctBy { it.id }
    val latestClasses = cachedClasses
        .filter { it.courseId.isNotBlank() }
        .sortedWith(compareByDescending<NativeClassItem> { it.publishedAt }.thenByDescending { it.order })
        .take(3)

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Hi ${state.profile?.name?.substringBefore(' ')?.ifBlank { "Student" } ?: "Student"}",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text("Your learning space", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Surface(
                    shape = CircleShape,
                    color = if (state.online) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Icon(
                        if (state.online) Icons.Default.CheckCircle else Icons.Default.CloudOff,
                        if (state.online) "Online" else "Offline",
                        Modifier.padding(11.dp).size(22.dp),
                        tint = if (state.online) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                shape = RoundedCornerShape(24.dp),
            ) {
                Column(Modifier.padding(18.dp)) {
                    Text("Learning summary", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        if (state.online) "Synced learning, ready when you are" else "Cached learning is still available",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.76f),
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        V2SummaryMetric("Courses", state.courses.size.toString(), Modifier.weight(1f))
                        V2SummaryMetric("Classes", cachedClasses.size.toString(), Modifier.weight(1f))
                        V2SummaryMetric("Offline", ready.toString(), Modifier.weight(1f))
                    }
                }
            }
        }
        item { V2Section("Quick access") }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    V2DashboardAction(
                        title = "Past classes",
                        subtitle = "Latest lessons, 5 per page",
                        icon = Icons.Default.History,
                        height = 154.dp,
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ) { nav.navigate("past-classes") }
                    V2DashboardAction(
                        title = "Downloads",
                        subtitle = "$ready ready offline",
                        icon = Icons.Default.Download,
                        height = 112.dp,
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ) { nav.navigate("downloads") }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    V2DashboardAction(
                        title = "My courses",
                        subtitle = "${state.courses.size} enrolled",
                        icon = Icons.Default.School,
                        height = 112.dp,
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    ) { nav.navigate("courses") }
                    V2DashboardAction(
                        title = "Add course",
                        subtitle = if (state.online) "Browse & buy inside the app" else "Connect to browse courses",
                        icon = Icons.Default.Add,
                        height = 154.dp,
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    ) { nav.navigate("add-course") }
                }
            }
        }
        if (latestClasses.isNotEmpty()) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    V2Section("Latest in your courses")
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { nav.navigate("past-classes") }) { Text("See all") }
                }
            }
            items(latestClasses, key = { "home-latest-${it.id}" }) { classItem ->
                V2ClassRow(classItem) { openClass(context, nav, classItem.courseId, classItem.id) }
            }
        } else if (state.courses.isNotEmpty()) {
            item {
                V2OutlinedCard {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.VideoLibrary, null)
                        Spacer(Modifier.width(10.dp))
                        Text("Open Past classes to load your latest cached lessons.", Modifier.weight(1f))
                    }
                }
            }
        }
        if (state.online) {
            item {
                TextButton(onClick = { viewModel.refreshOnline() }) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (state.syncing) "Syncing…" else "Sync learning data")
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2SummaryMetric(label: String, value: String, modifier: Modifier) {
    Surface(
        modifier.animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)),
        shape = RoundedCornerShape(14.dp),
        color = Color.White.copy(alpha = 0.20f),
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 11.dp)) {
            AnimatedContent(
                targetState = value,
                transitionSpec = {
                    (slideInVertically(animationSpec = tween(APP_MOTION_STANDARD_MS)) { it / 2 } +
                        fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS))) togetherWith
                        (slideOutVertically(animationSpec = tween(APP_MOTION_QUICK_MS)) { -it / 2 } +
                            fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)))
                },
                label = "$label metric",
            ) { animatedValue ->
                Text(animatedValue, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
            }
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun V2DashboardAction(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    height: Dp,
    containerColor: Color,
    contentColor: Color,
    onClick: () -> Unit,
) {
    Card(
        Modifier.fillMaxWidth().height(height)
            .animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS))
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = containerColor, contentColor = contentColor),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(Modifier.fillMaxSize().padding(15.dp)) {
            Surface(shape = RoundedCornerShape(13.dp), color = contentColor.copy(alpha = 0.10f)) {
                Icon(icon, null, Modifier.padding(9.dp).size(23.dp), tint = contentColor)
            }
            Spacer(Modifier.weight(1f))
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = contentColor.copy(alpha = 0.72f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
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
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("My Courses", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Enrolled courses", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { nav.navigate("add-course") }) { Text("Add course") }
            }
        }
        if (state.courses.isEmpty()) {
            item {
                V2OutlinedCard {
                    Column(Modifier.padding(18.dp)) {
                        Text("No enrolled course is synced yet.", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { nav.navigate("add-course") }, shape = V2Pill) { Text("Browse courses") }
                    }
                }
            }
        } else items(state.courses, key = { it.id }) { course -> V2CourseCard(course) { nav.navigate("course/${course.id}") } }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2PastCourses(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState) {
    LaunchedEffect(state.courses.isEmpty(), state.online) {
        if (state.courses.isEmpty() && state.online) viewModel.refreshOnline()
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, "Past classes") }
        item {
            V2OutlinedCard {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                        Icon(Icons.Default.History, null, Modifier.padding(11.dp).size(25.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${state.courses.size} enrolled courses", fontWeight = FontWeight.Bold)
                        Text(
                            if (state.online) "Cached courses appear first; missing content loads securely."
                            else "Offline • only previously cached lessons are available.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (state.courses.isEmpty()) {
            item {
                V2Empty(if (state.online) "No enrolled course is available yet. Add a course, then sync again." else "No course is cached on this device. Connect once to load your enrollments.")
            }
            if (state.online) item { Button(onClick = { nav.navigate("add-course") }, shape = V2Pill) { Text("Add a course") } }
        } else {
            items(state.courses, key = { "past-course-${it.id}" }) { course ->
                V2LearningRow(course.title, course.thumbnailUrl, Icons.Default.History) {
                    viewModel.loadCourse(course.id)
                    nav.navigate("past-classes/${course.id}")
                }
            }
        }
        if (state.online) {
            item {
                TextButton(onClick = { viewModel.refreshOnline() }) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (state.syncing) "Syncing…" else "Refresh enrollments")
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun V2PastClassPage(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    LaunchedEffect(courseId) { viewModel.loadCourse(courseId) }
    val content = state.courseContent[courseId]
    if (content == null) {
        V2Loading("Loading cached classes…")
        return
    }

    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    val classes = content.classes
        .filterNot { it.isArchived }
        .sortedWith(
            compareByDescending<NativeClassItem> { it.publishedAt }
                .thenByDescending { it.order }
                .thenBy { it.title.lowercase() },
        )
    val pageCount = maxOf(1, ceil(classes.size / PAST_CLASS_PAGE_SIZE.toDouble()).toInt())
    var page by rememberSaveable(courseId) { mutableIntStateOf(0) }
    LaunchedEffect(pageCount) { page = page.coerceIn(0, pageCount - 1) }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, course?.title ?: "Past classes") }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Latest classes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "${classes.size} lessons • 5 per page${if (!state.online) " • cached" else ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state.online) {
                    IconButton(onClick = { viewModel.loadCourse(courseId, force = true) }) { Icon(Icons.Default.Refresh, "Refresh classes") }
                }
            }
        }
        if (classes.isEmpty()) {
            item { V2Empty(if (state.online) "No class is available in this course yet." else "No class from this course is cached. Connect and retry.") }
        } else {
            item(key = "past-class-page-$courseId") {
                AnimatedContent(
                    targetState = page,
                    transitionSpec = {
                        val direction = if (targetState > initialState) 1 else -1
                        (slideInHorizontally(animationSpec = tween(APP_MOTION_EMPHASIZED_MS)) { width -> direction * width / 4 } +
                            fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS))) togetherWith
                            (slideOutHorizontally(animationSpec = tween(APP_MOTION_STANDARD_MS)) { width -> -direction * width / 5 } +
                                fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)))
                    },
                    label = "past class page",
                ) { activePage ->
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                        classes.drop(activePage * PAST_CLASS_PAGE_SIZE).take(PAST_CLASS_PAGE_SIZE).forEach { classItem ->
                            V2ClassRow(classItem) { openClass(context, nav, courseId, classItem.id) }
                        }
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { page -= 1 }, enabled = page > 0, shape = V2Pill, modifier = Modifier.weight(1f)) { Text("Previous") }
                    Surface(shape = V2Pill, color = MaterialTheme.colorScheme.surfaceVariant) {
                        Text("${page + 1} / $pageCount", Modifier.padding(horizontal = 13.dp, vertical = 10.dp), fontWeight = FontWeight.Bold)
                    }
                    Button(onClick = { page += 1 }, enabled = page < pageCount - 1, shape = V2Pill, modifier = Modifier.weight(1f)) {
                        Text("Next")
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Default.ArrowForward, null, Modifier.size(16.dp))
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@SuppressLint("AddJavascriptInterface", "SetJavaScriptEnabled")
@Composable
private fun V2AddCourse(nav: NavHostController, viewModel: NativeAppViewModel, state: NativeUiState) {
    val context = LocalContext.current
    val courseIds = state.courses.mapTo(linkedSetOf()) { it.id }
    val currentCourseIds by rememberUpdatedState(courseIds)
    var browser by remember { mutableStateOf<WebView?>(null) }
    var loading by remember { mutableStateOf(false) }
    var pageError by remember { mutableStateOf<String?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var awaitingEnrollment by remember { mutableStateOf(false) }
    var enrollmentBaseline by remember { mutableStateOf<Set<String>?>(null) }

    val returnToNativeCourses = {
        awaitingEnrollment = false
        viewModel.refreshOnline()
        nav.navigate("courses") {
            popUpTo("add-course") { inclusive = true }
            launchSingleTop = true
        }
    }
    val watchForEnrollment = {
        if (!awaitingEnrollment) enrollmentBaseline = currentCourseIds
        awaitingEnrollment = true
    }

    LaunchedEffect(awaitingEnrollment) {
        if (!awaitingEnrollment) return@LaunchedEffect
        repeat(24) {
            viewModel.refreshOnline()
            delay(1_250L)
        }
    }
    LaunchedEffect(awaitingEnrollment, courseIds) {
        val baseline = enrollmentBaseline ?: return@LaunchedEffect
        if (awaitingEnrollment && courseIds.any { it !in baseline }) returnToNativeCourses()
    }

    BackHandler(enabled = canGoBack) { browser?.goBack() }

    DisposableEffect(Unit) {
        onDispose {
            CookieManager.getInstance().flush()
            browser?.apply {
                stopLoading()
                webViewClient = WebViewClient()
                removeAllViews()
                destroy()
            }
            browser = null
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            V2Back(nav, "Add course")
        }
        Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { webContext ->
                    CookieManager.getInstance().apply { setAcceptCookie(true) }
                    WebView(webContext).apply {
                        browser = this
                        val courseStoreView = this
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.mediaPlaybackRequiresUserGesture = true
                        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        settings.userAgentString = "${settings.userAgentString} EasyEducationAndroid/${BuildConfig.VERSION_NAME}"
                        addJavascriptInterface(
                            NativeCourseStoreBridge(
                                onMyCourses = { courseStoreView.post { returnToNativeCourses() } },
                                onCheckoutComplete = { courseStoreView.post { watchForEnrollment() } },
                            ),
                            COURSE_STORE_BRIDGE,
                        )
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                loading = true
                                pageError = null
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                loading = false
                                canGoBack = view?.canGoBack() == true
                                CookieManager.getInstance().flush()
                                val target = runCatching { Uri.parse(url.orEmpty()) }.getOrNull()
                                if (target?.host == Uri.parse(WEB_ORIGIN).host) {
                                    view?.evaluateJavascript(COURSE_STORE_BRIDGE_SCRIPT, null)
                                    when (target?.path) {
                                        "/checkout-complete" -> watchForEnrollment()
                                        "/my-courses" -> returnToNativeCourses()
                                    }
                                }
                            }

                            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                                if (request?.isForMainFrame == true) {
                                    loading = false
                                    pageError = "Check your connection and try again."
                                }
                            }

                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val target = request?.url ?: return false
                                if (target.host == Uri.parse(WEB_ORIGIN).host && target.path == "/my-courses") {
                                    view?.post { returnToNativeCourses() }
                                    return true
                                }
                                val scheme = target.scheme.orEmpty().lowercase()
                                if (scheme == "http" || scheme == "https") return false
                                return runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, target))
                                    true
                                }.getOrDefault(true)
                            }
                        }
                        if (state.online) loadUrl("$WEB_ORIGIN/courses")
                    }
                },
                update = { webView ->
                    if (state.online && webView.url.isNullOrBlank() && pageError == null) webView.loadUrl("$WEB_ORIGIN/courses")
                },
            )
            val overlayState = when {
                !state.online -> "offline"
                pageError != null -> "error"
                else -> "ready"
            }
            AnimatedContent(
                targetState = overlayState,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    (fadeIn(animationSpec = tween(APP_MOTION_STANDARD_MS)) + scaleIn(initialScale = 0.985f, animationSpec = tween(APP_MOTION_STANDARD_MS))) togetherWith
                        (fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)) + scaleOut(targetScale = 0.99f, animationSpec = tween(APP_MOTION_QUICK_MS)))
                },
                label = "course store state",
            ) { target ->
                when (target) {
                    "offline" -> V2WebOffline(
                        title = "No internet connection",
                        message = "Connect to the internet to browse and buy a course. Your existing cached classes are still safe.",
                        onRetry = { pageError = null; if (state.online) browser?.reload() },
                    )
                    "error" -> V2WebOffline(
                        title = "Course store could not load",
                        message = pageError.orEmpty(),
                        onRetry = {
                            pageError = null
                            browser?.loadUrl("$WEB_ORIGIN/courses")
                        },
                    )
                    else -> Box(Modifier.fillMaxSize())
                }
            }
            AnimatedContent(
                targetState = loading && overlayState == "ready",
                modifier = Modifier.align(Alignment.TopCenter),
                transitionSpec = { fadeIn(animationSpec = tween(APP_MOTION_QUICK_MS)) togetherWith fadeOut(animationSpec = tween(APP_MOTION_QUICK_MS)) },
                label = "course store loading",
            ) { showProgress ->
                if (showProgress) LinearProgressIndicator(Modifier.fillMaxWidth()) else Spacer(Modifier.fillMaxWidth().height(4.dp))
            }
            AnimatedContent(
                targetState = awaitingEnrollment,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
                transitionSpec = {
                    (fadeIn(tween(APP_MOTION_QUICK_MS)) + slideInVertically(tween(APP_MOTION_STANDARD_MS)) { -it }) togetherWith
                        (fadeOut(tween(APP_MOTION_QUICK_MS)) + slideOutVertically(tween(APP_MOTION_STANDARD_MS)) { -it })
                },
                label = "course enrollment return",
            ) { showEnrollmentProgress ->
                if (showEnrollmentProgress) {
                    Surface(shape = V2Pill, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f)) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("Adding course to your app…", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                } else Spacer(Modifier.size(0.dp))
            }
        }
    }
}

@Composable
private fun V2WebOffline(title: String, message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        V2OutlinedCard {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Icon(Icons.Default.CloudOff, null, Modifier.padding(16.dp).size(34.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(16.dp))
                Button(onClick = onRetry, shape = V2Pill) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Try again")
                }
            }
        }
    }
}

@Composable
private fun V2CourseCard(course: NativeCourse, onClick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)).clickable(onClick = onClick),
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
    val regularClasses = content.classes.filterNot { it.isArchived }
    val hasArchive = content.classes.any { it.isArchived }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
        item { Spacer(Modifier.height(4.dp)); V2Back(nav, course?.title ?: "Course") }
        course?.thumbnailUrl?.takeIf { it.isNotBlank() }?.let { image ->
            item { AsyncImage(image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f).clip(RoundedCornerShape(14.dp))) }
        }
        course?.takeIf { it.telegramLink.isNotBlank() }?.let { telegramCourse ->
            item { NativeTelegramJoinCard(telegramCourse, state.online) }
        }
        if (hasArchive) {
            item { NativeArchiveEntryCard { nav.navigate("archive/$courseId") } }
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
                if (regularClasses.isEmpty()) item { V2Empty("No active classes are available yet.") }
                else items(regularClasses, key = { it.id }) { classItem ->
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
    val classes = content.classes.filter { classItem ->
        !classItem.isArchived && (classItem.subjects.isEmpty() || classItem.subjects.any { it.equals(subject, true) })
    }
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
            if (classes.isEmpty()) item { V2Empty("No active classes are available in this subject yet.") }
            else items(classes, key = { it.id }) { classItem ->
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
        !classItem.isArchived &&
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
        Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)).clickable(onClick = onClick),
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
        Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)).clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(13.dp),
    ) {
        Row(Modifier.padding(9.dp), verticalAlignment = Alignment.CenterVertically) {
            V2Thumbnail(classItem.imageUrl, Icons.Default.PlayArrow, Modifier.width(102.dp).height(66.dp))
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(classItem.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOf(classItem.teacherName, classItem.duration, classDateLabel(classItem.publishedAt))
                    .filter { it.isNotBlank() }
                    .joinToString(" • ")
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
                Switch(
                    checked = state.wifiOnlyDownloads,
                    onCheckedChange = viewModel::setWifiOnlyDownloads,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                        checkedTrackColor = MaterialTheme.colorScheme.primary,
                        checkedBorderColor = MaterialTheme.colorScheme.primary,
                        uncheckedThumbColor = MaterialTheme.colorScheme.onSurface,
                        uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant,
                        uncheckedBorderColor = MaterialTheme.colorScheme.outline,
                    ),
                )
            }
        }
        if (state.downloads.isEmpty()) item { V2Empty("No offline classes yet. Open a class and tap the compact Download button.") }
        else items(state.downloads, key = { it.id }) { task ->
            Card(
                Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)),
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
                            "downloading", "queued" -> OutlinedButton(onClick = { viewModel.pauseDownload(context, task.id) }, shape = V2Pill) {
                                Icon(Icons.Default.Pause, null); Spacer(Modifier.width(5.dp)); Text("Pause")
                            }
                            else -> OutlinedButton(onClick = { viewModel.resumeDownload(context, task.id) }, shape = V2Pill) {
                                Icon(Icons.Default.Refresh, null); Spacer(Modifier.width(5.dp)); Text("Resume")
                            }
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
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    themeMode: String,
    onThemeMode: (String) -> Unit,
    activeDevices: List<NativeActiveDevice>,
) {
    val context = LocalContext.current
    val profilePhoto = state.profile?.photoUrl.orEmpty()
    val visibleDevices = activeDevices.ifEmpty { listOf(NativeDeviceSession.currentDevice(context)) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)); Text("Profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) }
        item {
            V2OutlinedCard {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (profilePhoto.isNotBlank()) {
                        AsyncImage(profilePhoto, null, contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp).clip(CircleShape))
                    } else {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
                            Icon(Icons.Default.Person, null, Modifier.padding(14.dp).size(28.dp))
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(state.profile?.name?.ifBlank { state.user?.displayName ?: "Student" } ?: "Student", fontWeight = FontWeight.Bold)
                        Text(state.profile?.email?.ifBlank { state.user?.email.orEmpty() }.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Active devices: ${visibleDevices.size}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Logged-in devices", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                Surface(shape = V2Pill, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Text("${visibleDevices.size} active", Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        items(visibleDevices, key = { device -> device.id.ifBlank { device.name } }) { device ->
            V2OutlinedCard {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
                    Surface(shape = RoundedCornerShape(13.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                        Icon(Icons.Default.PhoneAndroid, null, Modifier.padding(11.dp).size(23.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(device.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (device.isCurrent) {
                                Surface(shape = V2Pill, color = MaterialTheme.colorScheme.primaryContainer) {
                                    Text("This device", Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                }
                            }
                        }
                        val platform = if (device.osVersion.isNotBlank()) "${device.platform.ifBlank { "Android" }} ${device.osVersion}" else device.platform
                        if (platform.isNotBlank()) Text(platform, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val details = listOf(
                            device.appVersion.takeIf { it.isNotBlank() }?.let { "App $it" },
                            device.screenResolution.takeIf { it.isNotBlank() },
                            device.language.takeIf { it.isNotBlank() },
                        ).filterNotNull().joinToString(" • ")
                        if (details.isNotBlank()) Text(details, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(if (device.isCurrent) "Active now" else v2DeviceLastSeen(device.lastSeen), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item {
            V2OutlinedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Palette, null); Spacer(Modifier.width(8.dp)); Text("Appearance", fontWeight = FontWeight.Bold)
                    }
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
                    OutlinedButton(onClick = { nav.navigate("add-course") }, modifier = Modifier.fillMaxWidth(), shape = V2Pill) {
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

private fun v2DeviceLastSeen(value: String): String {
    val instant = runCatching { java.time.Instant.parse(value) }.getOrNull() ?: return "Last active time unavailable"
    val formatted = SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault()).format(Date.from(instant))
    return "Last active $formatted"
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
        Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(APP_MOTION_STANDARD_MS)),
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

private fun classDateLabel(timestamp: Long): String {
    if (timestamp <= 0L) return ""
    return runCatching { SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).format(Date(timestamp)) }.getOrDefault("")
}

private fun openWeb(context: android.content.Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}
