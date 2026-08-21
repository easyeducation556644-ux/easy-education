package com.easyeducation.app

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

private const val CPS_ACADEMIC_CACHE = "cps_academic"
private const val CPS_ACADEMIC_API = "https://easy-education.vercel.app/api/cps"

data class NativeCpsPlaylistGroup(
    val id: String,
    val title: String,
    val type: String,
    val order: Int,
    val classIds: List<String>,
)

data class NativeCpsLiveRecording(
    val id: String,
    val title: String,
    val url: String,
    val thumbnailUrl: String,
)

data class NativeCpsAcademicLive(
    val id: String,
    val courseId: String,
    val playlistId: String,
    val playlistTitle: String,
    val title: String,
    val topic: String,
    val startTime: String,
    val status: String,
    val platform: String,
    val thumbnailUrl: String,
    val url: String,
    val recordings: List<NativeCpsLiveRecording>,
    val hasAccess: Boolean,
)

data class NativeCpsAcademicResource(
    val id: String,
    val classId: String,
    val playlistId: String,
    val chapter: String,
    val title: String,
    val kind: String,
    val url: String,
    val locked: Boolean,
)

data class NativeCpsTopic(
    val id: String,
    val classId: String,
    val classTitle: String,
    val playlistId: String,
    val chapter: String,
    val title: String,
    val videoTimestamp: Int,
    val canOpen: Boolean,
)

data class NativeCpsCalendarEvent(
    val id: String,
    val kind: String,
    val title: String,
    val startTime: String,
    val endTime: String,
    val status: String,
    val playlistId: String,
)

data class NativeCpsAcademicBundle(
    val courseId: String,
    val hasAccess: Boolean,
    val accessExpiresAtMs: Long,
    val playlists: List<NativeCpsPlaylistGroup>,
    val liveClasses: List<NativeCpsAcademicLive>,
    val resources: List<NativeCpsAcademicResource>,
    val topics: List<NativeCpsTopic>,
    val routine: String,
    val calendarEvents: List<NativeCpsCalendarEvent>,
)

class NativeCpsAcademicRepository(context: Context) {
    private val appContext = context.applicationContext
    private val cache = NativeCacheDb(appContext)
    private val auth = FirebaseAuth.getInstance()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    fun cached(courseId: String): NativeCpsAcademicBundle? {
        val rawId = courseId.removePrefix("cps:")
        val payload = cache.getDoc(CPS_ACADEMIC_CACHE, rawId) ?: return null
        return runCatching { parse(payload) }.getOrNull()
    }

    suspend fun refresh(courseId: String): NativeCpsAcademicBundle {
        val rawId = courseId.removePrefix("cps:")
        val user = auth.currentUser ?: error("Sign in to open CPS")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your session")
        val cpsToken = runCatching { CpsFirebaseSession.sourceIdToken(appContext, false) }.getOrNull()
        val url = "$CPS_ACADEMIC_API?action=academic&courseId=${URLEncoder.encode(rawId, Charsets.UTF_8.name())}"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .apply { if (!cpsToken.isNullOrBlank()) header("X-CPS-Firebase-Token", cpsToken) }
            .get()
            .build()
        val payload = withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
                if (!response.isSuccessful) error(json.optString("error").ifBlank { "CPS course details are temporarily unavailable" })
                json
            }
        }
        withContext(Dispatchers.IO) { cache.putDoc(CPS_ACADEMIC_CACHE, rawId, sanitizeForCache(payload)) }
        return parse(payload)
    }

    private fun sanitizeForCache(source: JSONObject): JSONObject {
        val safe = JSONObject(source.toString())
        safe.optJSONArray("liveClasses")?.forEachObject { item ->
            item.put("url", "")
            item.optJSONArray("recordings")?.forEachObject { it.put("url", "") }
        }
        safe.optJSONArray("resources")?.forEachObject { it.put("url", "") }
        return safe
    }

    private fun parse(payload: JSONObject): NativeCpsAcademicBundle = NativeCpsAcademicBundle(
        courseId = payload.optString("courseId"),
        hasAccess = payload.optBoolean("hasAccess", false),
        accessExpiresAtMs = payload.optLong("accessExpiresAtMs", 0L),
        playlists = payload.optJSONArray("playlists").objects().map { item ->
            NativeCpsPlaylistGroup(
                id = item.optString("id"),
                title = item.optString("title").ifBlank { "Part" },
                type = item.optString("type"),
                order = item.optInt("order", 0),
                classIds = item.optJSONArray("classIds").strings(),
            )
        },
        liveClasses = payload.optJSONArray("liveClasses").objects().map { item ->
            NativeCpsAcademicLive(
                id = item.optString("id"),
                courseId = item.optString("courseId"),
                playlistId = item.optString("playlistId"),
                playlistTitle = item.optString("playlistTitle").ifBlank { "Live classes" },
                title = item.optString("title").ifBlank { "Live class" },
                topic = item.optString("topic"),
                startTime = item.optString("startTime"),
                status = item.optString("status", "upcoming"),
                platform = item.optString("platform"),
                thumbnailUrl = item.optString("thumbnailUrl"),
                url = item.optString("url"),
                recordings = item.optJSONArray("recordings").objects().map { recording ->
                    NativeCpsLiveRecording(
                        id = recording.optString("id"),
                        title = recording.optString("title").ifBlank { "Recording" },
                        url = recording.optString("url"),
                        thumbnailUrl = recording.optString("thumbnailUrl"),
                    )
                },
                hasAccess = item.optBoolean("hasAccess", false),
            )
        },
        resources = payload.optJSONArray("resources").objects().map { item ->
            NativeCpsAcademicResource(
                id = item.optString("id"),
                classId = item.optString("classId"),
                playlistId = item.optString("playlistId"),
                chapter = item.optString("chapter").ifBlank { "Resources" },
                title = item.optString("title").ifBlank { "Resource" },
                kind = item.optString("kind"),
                url = item.optString("url"),
                locked = item.optBoolean("locked", true),
            )
        },
        topics = payload.optJSONArray("topics").objects().map { item ->
            NativeCpsTopic(
                id = item.optString("id"),
                classId = item.optString("classId"),
                classTitle = item.optString("classTitle"),
                playlistId = item.optString("playlistId"),
                chapter = item.optString("chapter").ifBlank { "Topics" },
                title = item.optString("title").ifBlank { "Topic" },
                videoTimestamp = item.optInt("videoTimestamp", 0),
                canOpen = item.optBoolean("canOpen", false),
            )
        },
        routine = payload.optString("routine"),
        calendarEvents = payload.optJSONArray("calendarEvents").objects().map { item ->
            NativeCpsCalendarEvent(
                id = item.optString("id"),
                kind = item.optString("kind"),
                title = item.optString("title").ifBlank { "Event" },
                startTime = item.optString("startTime"),
                endTime = item.optString("endTime"),
                status = item.optString("status"),
                playlistId = item.optString("playlistId"),
            )
        },
    )

    private fun JSONArray?.objects(): List<JSONObject> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) optJSONObject(index)?.let(::add) }
    }

    private fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) optString(index).takeIf { it.isNotBlank() }?.let(::add) }
    }

    private inline fun JSONArray.forEachObject(block: (JSONObject) -> Unit) {
        for (index in 0 until length()) optJSONObject(index)?.let(block)
    }
}
