package com.easyeducation.app

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class NativeExternalProvider(
    val id: String,
    val name: String,
)

data class NativeExternalCourse(
    val id: String,
    val slug: String,
    val title: String,
    val description: String,
    val thumbnailUrl: String,
    val batch: String,
    val provider: String,
    val providerName: String,
)

data class NativeExternalClass(
    val id: String,
    val title: String,
    val topic: String,
    val sectionTitle: String,
    val chapterTitle: String,
    val sourceUrl: String,
    val teacherName: String,
    val imageUrl: String,
    val order: Int,
    val resourceLinks: List<NativeResourceLink>,
)

data class NativeExternalCourseDetail(
    val provider: NativeExternalProvider,
    val course: NativeExternalCourse,
    val classes: List<NativeExternalClass>,
)

class NativeExternalCoursesRepository(context: Context) {
    private val appContext = context.applicationContext
    private val cache = appContext.getSharedPreferences("external_course_cache_v1", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun catalog(provider: String, cachedOnly: Boolean = false): List<NativeExternalCourse> {
        val safeProvider = provider.trim().lowercase()
        val root = payload(
            "catalog:$safeProvider",
            "$APP_ORIGIN/api/external-courses?action=catalog&provider=${encode(safeProvider)}",
            cachedOnly,
        )
        return root.array("courses").mapObjects(::parseCourse)
    }

    fun course(provider: String, courseId: String, cachedOnly: Boolean = false): NativeExternalCourseDetail {
        val safeProvider = provider.trim().lowercase()
        val root = payload(
            "course:$safeProvider:$courseId",
            "$APP_ORIGIN/api/external-courses?action=course&provider=${encode(safeProvider)}&courseId=${encode(courseId)}",
            cachedOnly,
        )
        val providerJson = root.optJSONObject("provider") ?: JSONObject()
        val courseJson = root.optJSONObject("course") ?: error("Course details are unavailable")
        return NativeExternalCourseDetail(
            provider = NativeExternalProvider(
                id = providerJson.optString("id", safeProvider),
                name = providerJson.optString("name").ifBlank { providerTitle(safeProvider) },
            ),
            course = parseCourse(courseJson),
            classes = root.array("classes").mapObjects { item ->
                NativeExternalClass(
                    id = item.optString("id"),
                    title = item.optString("title").ifBlank { "Class" },
                    topic = item.optString("topic"),
                    sectionTitle = item.optString("sectionTitle").ifBlank { "Classes" },
                    chapterTitle = item.optString("chapterTitle").ifBlank { item.optString("sectionTitle").ifBlank { "Classes" } },
                    sourceUrl = item.optString("sourceUrl"),
                    teacherName = item.optString("teacherName").ifBlank { providerTitle(safeProvider) },
                    imageUrl = item.optString("imageUrl"),
                    order = item.optInt("order", 0),
                    resourceLinks = item.array("resourceLinks").mapObjects { resource ->
                        NativeResourceLink(
                            label = resource.optString("label").ifBlank { "Resource" },
                            url = resource.optString("url"),
                        )
                    }.filter { it.url.isNotBlank() },
                )
            }.filter { it.id.isNotBlank() && it.sourceUrl.isNotBlank() }
                .sortedWith(compareBy<NativeExternalClass> { it.order }.thenBy { it.title }),
        )
    }

    fun cachedCatalog(provider: String): List<NativeExternalCourse> =
        runCatching { catalog(provider, true) }.getOrDefault(emptyList())

    fun cachedCourse(provider: String, courseId: String): NativeExternalCourseDetail? =
        runCatching { course(provider, courseId, true) }.getOrNull()

    private fun parseCourse(json: JSONObject): NativeExternalCourse = NativeExternalCourse(
        id = json.optString("id"),
        slug = json.optString("slug"),
        title = json.optString("title").ifBlank { "Course" },
        description = json.optString("description"),
        thumbnailUrl = json.optString("thumbnailUrl"),
        batch = json.optString("batch"),
        provider = json.optString("provider"),
        providerName = json.optString("providerName").ifBlank { providerTitle(json.optString("provider")) },
    )

    private fun payload(cacheKey: String, url: String, cachedOnly: Boolean): JSONObject {
        val scoped = scopedKey(cacheKey)
        if (cachedOnly) {
            val raw = cache.getString(scoped, null) ?: error("No cached provider data")
            return JSONObject(raw)
        }
        val fresh = request(url)
        cache.edit().putString(scoped, fresh.toString()).apply()
        return fresh
    }

    private fun scopedKey(value: String): String {
        val uid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty().ifBlank { "anonymous" }
        return "$uid:$value"
    }

    private fun request(url: String): JSONObject {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not refresh your login")
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse { error("Provider returned an invalid response") }
            if (!response.isSuccessful) error(json.optString("error").ifBlank { "Provider request failed (${response.code})" })
            return json
        }
    }

    private fun JSONObject.array(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

    private fun <T> JSONArray.mapObjects(mapper: (JSONObject) -> T): List<T> = buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            add(mapper(item))
        }
    }

    companion object {
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
        val providers = listOf(
            NativeExternalProvider("ieducation", "iEducation"),
            NativeExternalProvider("medilogy", "Medilogy"),
            NativeExternalProvider("bpschool", "BP School"),
        )

        fun providerTitle(id: String): String = providers.firstOrNull { it.id == id }?.name ?: id.ifBlank { "Learning" }
        private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}
