package com.easyeducation.app

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class NativeEdgeCourse(
    val id: String,
    val title: String,
    val description: String,
    val thumbnailUrl: String,
    val sourceUrl: String,
    val hasAccess: Boolean,
    val accessType: String,
    val accessExpiresAtMs: Long,
    val inMyCourses: Boolean = false,
    val addedAtMs: Long = 0L,
)

data class NativeEdgeCatalog(
    val courses: List<NativeEdgeCourse> = emptyList(),
    val page: Int = 1,
    val count: Int = 0,
    val totalPages: Int = 1,
    val hasNext: Boolean = false,
    val hasPrevious: Boolean = false,
    val accessMode: String = "free",
)

data class NativeEdgeLink(
    val label: String,
    val kind: String,
    val url: String,
    val playable: Boolean,
)

data class NativeEdgeItem(
    val id: String,
    val title: String,
    val description: String,
    val kind: String,
    val links: List<NativeEdgeLink>,
    val locked: Boolean,
)

data class NativeEdgeModule(
    val id: String,
    val title: String,
    val items: List<NativeEdgeItem>,
)

data class NativeEdgeSection(
    val id: String,
    val title: String,
    val modules: List<NativeEdgeModule>,
    val materials: List<NativeEdgeItem>,
)

data class NativeEdgeHeader(
    val id: String,
    val title: String,
    val sections: List<NativeEdgeSection>,
)

data class NativeEdgeCounts(
    val headers: Int = 0,
    val sections: Int = 0,
    val modules: Int = 0,
    val items: Int = 0,
    val videos: Int = 0,
    val materials: Int = 0,
)

data class NativeEdgeCourseDetail(
    val course: NativeEdgeCourse,
    val headers: List<NativeEdgeHeader>,
    val counts: NativeEdgeCounts,
    val accessMode: String,
)

class NativeEdgeCourseRepository(context: Context) {
    private val appContext = context.applicationContext
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    fun catalog(page: Int = 1, search: String = ""): NativeEdgeCatalog {
        val params = buildString {
            append("action=catalog&page=").append(page.coerceAtLeast(1))
            if (search.isNotBlank()) {
                append("&search=").append(URLEncoder.encode(search.trim(), Charsets.UTF_8.name()))
            }
        }
        val root = request("$APP_ORIGIN/api/edgecourse?$params")
        return NativeEdgeCatalog(
            courses = root.array("courses").mapObjects(::parseCourse),
            page = root.optInt("page", page.coerceAtLeast(1)),
            count = root.optInt("count", 0),
            totalPages = root.optInt("totalPages", 1).coerceAtLeast(1),
            hasNext = root.optString("next").isNotBlank(),
            hasPrevious = root.optString("previous").isNotBlank(),
            accessMode = root.optString("accessMode", "free"),
        )
    }

    fun course(courseId: String): NativeEdgeCourseDetail {
        val safeId = URLEncoder.encode(courseId.trim(), Charsets.UTF_8.name())
        val root = request("$APP_ORIGIN/api/edgecourse?action=course&courseId=$safeId")
        val courseJson = root.optJSONObject("course") ?: error("EdgeCourse detail is missing course metadata")
        return NativeEdgeCourseDetail(
            course = parseCourse(courseJson),
            headers = root.array("headers").mapObjects(::parseHeader),
            counts = parseCounts(root.optJSONObject("counts")),
            accessMode = root.optString("accessMode", "free"),
        )
    }

    fun myCourses(): List<NativeEdgeCourse> {
        val root = request("$APP_ORIGIN/api/edgecourse?action=my-courses")
        return root.array("courses").mapObjects(::parseCourse)
    }

    fun addToMyCourses(courseId: String): NativeEdgeCourse {
        val root = request(
            "$APP_ORIGIN/api/edgecourse?action=add-to-my-courses",
            JSONObject().put("courseId", courseId.trim()),
        )
        val courseJson = root.optJSONObject("course") ?: error("EdgeCourse could not be added to My Courses")
        return parseCourse(courseJson)
    }

    private fun request(url: String, body: JSONObject? = null): JSONObject {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in to open EdgeCourse")
        val idToken = Tasks.await(user.getIdToken(false)).token ?: error("Could not refresh your login")
        val builder = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $idToken")
            .header("Accept", "application/json")
        if (body == null) builder.get()
        else builder.post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        val request = builder.build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(body) }.getOrElse {
                error("EdgeCourse returned an invalid response")
            }
            if (!response.isSuccessful) {
                error(json.optString("error").ifBlank { "EdgeCourse request failed (${response.code})" })
            }
            return json
        }
    }

    private fun parseCourse(json: JSONObject) = NativeEdgeCourse(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "EdgeCourse" },
        description = json.optString("description"),
        thumbnailUrl = json.optString("thumbnailUrl"),
        sourceUrl = json.optString("sourceUrl"),
        hasAccess = json.optBoolean("hasAccess", true),
        accessType = json.optString("accessType", "free"),
        accessExpiresAtMs = json.optLong("accessExpiresAtMs", 0L),
        inMyCourses = json.optBoolean("inMyCourses", false),
        addedAtMs = json.optLong("addedAtMs", 0L),
    )

    private fun parseHeader(json: JSONObject) = NativeEdgeHeader(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Course part" },
        sections = json.array("sections").mapObjects(::parseSection),
    )

    private fun parseSection(json: JSONObject) = NativeEdgeSection(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Section" },
        modules = json.array("modules").mapObjects(::parseModule),
        materials = json.array("materials").mapObjects(::parseItem),
    )

    private fun parseModule(json: JSONObject) = NativeEdgeModule(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Module" },
        items = json.array("items").mapObjects(::parseItem),
    )

    private fun parseItem(json: JSONObject) = NativeEdgeItem(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Content" },
        description = json.optString("description"),
        kind = json.optString("kind", "material"),
        links = json.array("links").mapObjects { link ->
            NativeEdgeLink(
                label = link.optString("label").ifBlank { "Open" },
                kind = link.optString("kind", "link"),
                url = link.optString("url"),
                playable = link.optBoolean("playable", false),
            )
        },
        locked = json.optBoolean("locked", false),
    )

    private fun parseCounts(json: JSONObject?) = NativeEdgeCounts(
        headers = json?.optInt("headers", 0) ?: 0,
        sections = json?.optInt("sections", 0) ?: 0,
        modules = json?.optInt("modules", 0) ?: 0,
        items = json?.optInt("items", 0) ?: 0,
        videos = json?.optInt("videos", 0) ?: 0,
        materials = json?.optInt("materials", 0) ?: 0,
    )

    private fun JSONObject.array(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

    private fun <T> JSONArray.mapObjects(mapper: (JSONObject) -> T): List<T> = buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            add(mapper(item))
        }
    }

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
    }
}
