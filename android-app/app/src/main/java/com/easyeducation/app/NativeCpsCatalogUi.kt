package com.easyeducation.app

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

private const val CPS_CATALOG_ORIGIN = "https://easy-education.vercel.app"
private const val CPS_CATALOG_CACHE = "cps_catalog_v3"
private const val CPS_PREVIEW_PREFIX = "cps_preview_v3:"
private const val CPS_CACHE_PREFS = "easy_education_cps_catalog"
private val CpsHeroShape = RoundedCornerShape(24.dp)
private val CpsCardShape = RoundedCornerShape(18.dp)

private data class CpsCatalogCourse(
    val id: String,
    val title: String,
    val description: String,
    val thumbnail: String,
    val hasAccess: Boolean,
    val hasLiveClass: Boolean,
    val hasInstantClass: Boolean,
    val classCount: Int,
    val playlistCount: Int,
    val accessExpiresAtMs: Long,
)

private data class CpsFeaturedLive(
    val courseId: String,
    val courseTitle: String,
    val title: String,
    val startTime: String,
    val status: String,
    val hasAccess: Boolean,
)

private data class CpsCatalogSnapshot(
    val courses: List<CpsCatalogCourse> = emptyList(),
    val featuredLive: CpsFeaturedLive? = null,
)

private data class CpsPreviewClass(
    val id: String,
    val title: String,
    val topic: String,
    val subject: String,
    val duration: String,
    val hasVideo: Boolean,
    val hasResource: Boolean,
)

private data class CpsPreviewLive(
    val id: String,
    val title: String,
    val startTime: String,
    val status: String,
)

private data class CpsPreviewPayload(
    val course: CpsCatalogCourse,
    val classes: List<CpsPreviewClass>,
    val liveClasses: List<CpsPreviewLive>,
    val examCount: Int,
    val routines: String,
    val updates: String,
)

private class NativeCpsCatalogClient(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(CPS_CACHE_PREFS, Context.MODE_PRIVATE)
    private val auth = FirebaseAuth.getInstance()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    fun cachedCatalog(): CpsCatalogSnapshot? = prefs.getString(CPS_CATALOG_CACHE, null)
        ?.let { runCatching { parseCatalog(JSONObject(it)) }.getOrNull() }

    suspend fun refreshCatalog(): CpsCatalogSnapshot {
        val payload = request("catalog")
        prefs.edit().putString(CPS_CATALOG_CACHE, payload.toString()).apply()
        return parseCatalog(payload)
    }

    fun cachedPreview(courseId: String): CpsPreviewPayload? = prefs.getString(CPS_PREVIEW_PREFIX + courseId, null)
        ?.let { runCatching { parsePreview(JSONObject(it)) }.getOrNull() }

    suspend fun refreshPreview(courseId: String): CpsPreviewPayload {
        val payload = request("preview", mapOf("courseId" to courseId.removePrefix("cps:")))
        prefs.edit().putString(CPS_PREVIEW_PREFIX + courseId, payload.toString()).apply()
        return parsePreview(payload)
    }

    private suspend fun request(action: String, params: Map<String, String> = emptyMap()): JSONObject {
        val user = auth.currentUser ?: error("Sign in to browse CPS")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your account")
        val query = buildList {
            add("action=${encode(action)}")
            params.forEach { (key, value) -> add("${encode(key)}=${encode(value)}") }
        }.joinToString("&")
        val request = Request.Builder()
            .url("$CPS_CATALOG_ORIGIN/api/cps?$query")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
                        ?.takeIf { it.isNotBlank() }
                        ?: "CPS request failed (${response.code})"
                    error(message)
                }
                JSONObject(body)
            }
        }
    }

    private fun parseCatalog(payload: JSONObject): CpsCatalogSnapshot {
        val courses = payload.optJSONArray("courses").objects().map(::parseCourse)
        val live = payload.optJSONObject("featuredLive")?.let(::parseFeaturedLive)
        return CpsCatalogSnapshot(courses, live)
    }

    private fun parsePreview(payload: JSONObject): CpsPreviewPayload {
        val course = payload.optJSONObject("course")?.let(::parseCourse)
            ?: error("CPS course preview is unavailable")
        val classes = payload.optJSONArray("classes").objects().map { item ->
            CpsPreviewClass(
                id = item.optString("id"),
                title = item.optString("title").ifBlank { "Class" },
                topic = item.optString("topic"),
                subject = item.optJSONArray("subject").strings().firstOrNull().orEmpty(),
                duration = item.optString("duration"),
                hasVideo = item.optBoolean("hasVideo", false),
                hasResource = item.optBoolean("hasResource", false),
            )
        }
        val live = payload.optJSONArray("liveClasses").objects().map { item ->
            CpsPreviewLive(
                id = item.optString("id"),
                title = item.optString("title").ifBlank { "Live class" },
                startTime = item.optString("startTime"),
                status = item.optString("status"),
            )
        }
        return CpsPreviewPayload(
            course = course,
            classes = classes,
            liveClasses = live,
            examCount = payload.optJSONArray("exams")?.length() ?: 0,
            routines = payload.optString("routines"),
            updates = payload.optString("updates"),
        )
    }

    private fun parseCourse(item: JSONObject): CpsCatalogCourse {
        val expiresAt = item.optLong("accessExpiresAtMs", 0L)
        val accessFlag = item.optBoolean("hasAccess", false)
        val accessActive = accessFlag && (expiresAt == 0L || expiresAt > System.currentTimeMillis())
        return CpsCatalogCourse(
            id = item.optString("id"),
            title = item.optString("title").ifBlank { "CPS Course" },
            description = item.optString("description"),
            thumbnail = item.optString("thumbnail"),
            hasAccess = accessActive,
            hasLiveClass = item.optBoolean("hasLiveClass", false),
            hasInstantClass = item.optBoolean("hasInstantClass", false),
            classCount = item.optInt("classCount", 0),
            playlistCount = item.optInt("playlistCount", 0),
            accessExpiresAtMs = expiresAt,
        )
    }

    private fun parseFeaturedLive(item: JSONObject) = CpsFeaturedLive(
        courseId = item.optString("courseId"),
        courseTitle = item.optString("courseTitle").ifBlank { "CPS" },
        title = item.optString("title").ifBlank { "Live class" },
        startTime = item.optString("startTime"),
        status = item.optString("status"),
        hasAccess = item.optBoolean("hasAccess", false),
    )

    private fun JSONArray?.objects(): List<JSONObject> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) optJSONObject(index)?.let(::add) }
    }

    private fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) optString(index).takeIf { it.isNotBlank() }?.let(::add)
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}

@Composable
fun NativeCpsHomeHero(nav: NavHostController, online: Boolean) {
    val context = LocalContext.current
    val client = remember { NativeCpsCatalogClient(context) }
    var snapshot by remember { mutableStateOf(client.cachedCatalog()) }

    LaunchedEffect(online) {
        client.cachedCatalog()?.let { snapshot = it }
        if (online) {
            while (true) {
                runCatching { client.refreshCatalog() }.onSuccess { snapshot = it }
                delay(60_000L)
            }
        }
    }

    val live = snapshot?.featuredLive
    val running = live?.status?.lowercase() in setOf("live", "running", "ongoing", "started")
    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("cps") },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = CpsHeroShape,
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.10f)) {
                    Icon(Icons.Default.School, null, Modifier.padding(10.dp).size(25.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text("CPS", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Live + instant academic classes", style = MaterialTheme.typography.bodySmall)
                }
                Icon(Icons.Default.ArrowForward, "Open CPS")
            }
            if (live != null) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = if (running) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surface.copy(alpha = 0.58f),
                ) {
                    Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.LiveTv,
                            null,
                            Modifier.size(25.dp),
                            tint = if (running) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (running) "LIVE NOW" else "TODAY'S LIVE CLASS",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.ExtraBold,
                            )
                            Text(live.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOf(live.courseTitle, cpsTimeLabel(live.startTime)).filter { it.isNotBlank() }.joinToString(" • "),
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)) {
                            Icon(if (live.hasAccess) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.padding(8.dp).size(17.dp))
                        }
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PlayCircle, null, Modifier.size(21.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (online) "Browse CPS courses, live classes and instant lessons" else "CPS catalog • cached when available",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
fun NativeCpsHubScreen(nav: NavHostController, online: Boolean) {
    val context = LocalContext.current
    val client = remember { NativeCpsCatalogClient(context) }
    var snapshot by remember { mutableStateOf(client.cachedCatalog()) }
    var loading by remember { mutableStateOf(snapshot == null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(online) {
        client.cachedCatalog()?.let { snapshot = it }
        if (online) {
            loading = snapshot == null
            runCatching { client.refreshCatalog() }
                .onSuccess { snapshot = it; error = null }
                .onFailure { error = it.message }
            loading = false
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text("CPS", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Text("Live classes • Instant classes • Exams", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        snapshot?.featuredLive?.let { live ->
            item { CpsFeaturedLiveCard(live) }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Courses", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text("${snapshot?.courses?.size ?: 0}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        when {
            loading -> item { Box(Modifier.fillMaxWidth().height(150.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            snapshot?.courses.isNullOrEmpty() -> item {
                CpsInfoCard(if (online) (error ?: "No CPS courses are available right now.") else "Connect once to cache the CPS catalog.")
            }
            else -> items(
                snapshot!!.courses.sortedWith(compareByDescending<CpsCatalogCourse> { it.hasAccess }.thenBy { it.title.lowercase() }),
                key = { it.id },
            ) { course ->
                CpsCatalogCourseCard(course) {
                    if (course.hasAccess) nav.navigate("course/${course.id}")
                    else nav.navigate("cps-preview/${Uri.encode(course.id)}")
                }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
fun NativeCpsCoursePreviewScreen(nav: NavHostController, encodedCourseId: String, online: Boolean) {
    val courseId = Uri.decode(encodedCourseId)
    val context = LocalContext.current
    val client = remember { NativeCpsCatalogClient(context) }
    var payload by remember(courseId) { mutableStateOf(client.cachedPreview(courseId)) }
    var loading by remember(courseId) { mutableStateOf(payload == null) }
    var error by remember(courseId) { mutableStateOf<String?>(null) }

    LaunchedEffect(courseId, online) {
        client.cachedPreview(courseId)?.let { payload = it }
        if (online) {
            loading = payload == null
            runCatching { client.refreshPreview(courseId) }
                .onSuccess { payload = it; error = null }
                .onFailure { error = it.message }
            loading = false
        }
    }

    val data = payload
    if (loading && data == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Text(data?.course?.title ?: "CPS course", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            }
        }
        if (data == null) {
            item { CpsInfoCard(error ?: if (online) "Course preview is unavailable." else "Connect to load this course preview.") }
        } else {
            data.course.thumbnail.takeIf { it.isNotBlank() }?.let { image ->
                item {
                    AsyncImage(
                        model = image,
                        contentDescription = data.course.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f).clip(CpsCardShape),
                    )
                }
            }
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                    shape = CpsCardShape,
                ) {
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            if (data.course.hasLiveClass) CpsBadge("WITH LIVE CLASS")
                            if (data.course.hasInstantClass) CpsBadge("INSTANT CLASS")
                        }
                        Text(data.course.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        if (data.course.description.isNotBlank()) {
                            Text(data.course.description, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.78f), maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                        Text(
                            "${data.course.classCount} classes • ${data.course.playlistCount} sections • ${data.liveClasses.size} live • ${data.examCount} exams",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (data.course.hasAccess) {
                            Button(onClick = { nav.navigate("course/${data.course.id}") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(999.dp)) {
                                Icon(Icons.Default.CheckCircle, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(7.dp))
                                Text("Open course")
                            }
                        } else {
                            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.62f)) {
                                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Lock, null, Modifier.size(20.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Column {
                                        Text("Access required", fontWeight = FontWeight.Bold)
                                        Text("You can browse the full curriculum. Playback unlocks after admin access.", style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (data.liveClasses.isNotEmpty()) {
                item { Text("Live classes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                items(data.liveClasses, key = { "preview-live-${it.id}" }) { live ->
                    Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.LiveTv, null, Modifier.size(23.dp))
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(live.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(listOf(live.status, cpsTimeLabel(live.startTime)).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (!data.course.hasAccess) Icon(Icons.Default.Lock, "Locked", Modifier.size(18.dp))
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Curriculum", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text("${data.classes.size} classes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (data.classes.isEmpty()) {
                item { CpsInfoCard("No recorded class metadata is available yet.") }
            } else {
                items(data.classes, key = { it.id }) { item -> CpsLockedClassRow(item, !data.course.hasAccess) }
            }
            if (data.routines.isNotBlank()) {
                item { CpsTextSection("Routine", data.routines) }
            }
            if (data.updates.isNotBlank()) {
                item { CpsTextSection("Updates", data.updates) }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun CpsFeaturedLiveCard(live: CpsFeaturedLive) {
    val running = live.status.lowercase() in setOf("live", "running", "ongoing", "started")
    Card(
        colors = CardDefaults.cardColors(containerColor = if (running) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.tertiaryContainer),
        shape = CpsCardShape,
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.62f)) {
                Icon(Icons.Default.LiveTv, null, Modifier.padding(10.dp).size(24.dp))
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(if (running) "LIVE NOW" else "TODAY", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.ExtraBold)
                Text(live.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOf(live.courseTitle, cpsTimeLabel(live.startTime)).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall)
            }
            Icon(if (live.hasAccess) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.size(20.dp))
        }
    }
}

@Composable
private fun CpsCatalogCourseCard(course: CpsCatalogCourse, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, if (course.hasAccess) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline),
        shape = CpsCardShape,
    ) {
        Column {
            if (course.thumbnail.isNotBlank()) {
                AsyncImage(course.thumbnail, course.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f))
            }
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (course.hasLiveClass) CpsBadge("WITH LIVE CLASS")
                    if (course.hasInstantClass) CpsBadge("INSTANT CLASS")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(course.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${course.classCount} classes • ${course.playlistCount} sections", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Surface(shape = CircleShape, color = if (course.hasAccess) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant) {
                        Icon(if (course.hasAccess) Icons.Default.CheckCircle else Icons.Default.Lock, null, Modifier.padding(9.dp).size(19.dp))
                    }
                }
                if (!course.hasAccess) Text("Curriculum visible • videos locked", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun CpsLockedClassRow(item: CpsPreviewClass, locked: Boolean) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Icon(Icons.Default.PlayCircle, null, Modifier.padding(9.dp).size(23.dp))
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOf(item.subject, item.duration).filter { it.isNotBlank() }.joinToString(" • ")
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val extras = buildList {
                    if (item.hasVideo) add("Video")
                    if (item.hasResource) add("Resources")
                }.joinToString(" • ")
                if (extras.isNotBlank()) Text(extras, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (locked) Icon(Icons.Default.Lock, "Locked", Modifier.size(18.dp))
        }
    }
}

@Composable
private fun CpsBadge(text: String) {
    Surface(shape = RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun CpsTextSection(title: String, text: String) {
    Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CpsInfoCard(message: String) {
    Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(14.dp)) {
        Text(message, Modifier.padding(17.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun cpsTimeLabel(value: String): String {
    if (value.isBlank()) return ""
    return runCatching {
        val instant = Instant.parse(value)
        DateTimeFormatter.ofPattern("dd MMM • h:mm a")
            .withZone(ZoneId.of("Asia/Dhaka"))
            .format(instant)
    }.getOrElse { value }
}
