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
    val sectionId: String,
    val lectureId: String,
    val sectionTitle: String,
    val chapterTitle: String,
    val sourceUrl: String,
    val teacherName: String,
    val imageUrl: String,
    val order: Int,
    val resourceLinks: List<NativeResourceLink>,
)

data class NativeExternalContentItem(
    val id: String,
    val title: String,
    val topic: String,
    val type: String,
    val linkType: String,
    val sourceUrl: String,
    val playable: Boolean,
    val teacherName: String,
    val imageUrl: String,
    val order: Int,
    val resourceLinks: List<NativeResourceLink>,
)

data class NativeExternalLecture(
    val id: String,
    val title: String,
    val description: String,
    val order: Int,
    val items: List<NativeExternalContentItem>,
)

data class NativeExternalSection(
    val id: String,
    val title: String,
    val description: String,
    val order: Int,
    val lectures: List<NativeExternalLecture>,
)

data class NativeExternalCourseDetail(
    val provider: NativeExternalProvider,
    val course: NativeExternalCourse,
    val sections: List<NativeExternalSection>,
    val classes: List<NativeExternalClass>,
)

class NativeExternalCoursesRepository(context: Context) {
    private val appContext = context.applicationContext
    private val cache = appContext.getSharedPreferences("external_course_cache_v2", Context.MODE_PRIVATE)
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
        val providerValue = NativeExternalProvider(
            id = providerJson.optString("id", safeProvider),
            name = providerJson.optString("name").ifBlank { providerTitle(safeProvider) },
        )
        val classes = root.array("classes").mapObjects { item -> parseClass(item, safeProvider) }
            .filter { it.id.isNotBlank() && it.sourceUrl.isNotBlank() }
            .sortedWith(compareBy<NativeExternalClass> { it.order }.thenBy { it.title })
        val parsedSections = root.array("sections").mapObjects { parseSection(it, safeProvider) }
            .sortedWith(compareBy<NativeExternalSection> { it.order }.thenBy { it.title })
        val sections = if (parsedSections.isNotEmpty()) parsedSections else hierarchyFromClasses(classes)
        return NativeExternalCourseDetail(
            provider = providerValue,
            course = parseCourse(courseJson),
            sections = sections,
            classes = classes,
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

    private fun parseClass(item: JSONObject, safeProvider: String): NativeExternalClass = NativeExternalClass(
        id = item.optString("id"),
        title = item.optString("title").ifBlank { "Class" },
        topic = item.optString("topic"),
        sectionId = item.optString("sectionId"),
        lectureId = item.optString("lectureId"),
        sectionTitle = item.optString("sectionTitle").ifBlank { "Classes" },
        chapterTitle = item.optString("chapterTitle").ifBlank { item.optString("sectionTitle").ifBlank { "Classes" } },
        sourceUrl = item.optString("sourceUrl"),
        teacherName = item.optString("teacherName").ifBlank { providerTitle(safeProvider) },
        imageUrl = item.optString("imageUrl"),
        order = item.optInt("order", 0),
        resourceLinks = parseResources(item),
    )

    private fun parseSection(json: JSONObject, safeProvider: String): NativeExternalSection = NativeExternalSection(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Section" },
        description = json.optString("description"),
        order = json.optInt("order", 0),
        lectures = json.array("lectures").mapObjects { parseLecture(it, safeProvider) }
            .sortedWith(compareBy<NativeExternalLecture> { it.order }.thenBy { it.title }),
    )

    private fun parseLecture(json: JSONObject, safeProvider: String): NativeExternalLecture = NativeExternalLecture(
        id = json.optString("id"),
        title = json.optString("title").ifBlank { "Lecture" },
        description = json.optString("description"),
        order = json.optInt("order", 0),
        items = json.array("items").mapObjects { parseContentItem(it, safeProvider) }
            .sortedWith(compareBy<NativeExternalContentItem> { it.order }.thenBy { it.title }),
    )

    private fun parseContentItem(json: JSONObject, safeProvider: String): NativeExternalContentItem {
        val sourceUrl = json.optString("sourceUrl")
        return NativeExternalContentItem(
            id = json.optString("id"),
            title = json.optString("title").ifBlank { "Content" },
            topic = json.optString("topic"),
            type = json.optString("type").ifBlank { "Content" },
            linkType = json.optString("linkType"),
            sourceUrl = sourceUrl,
            playable = json.optBoolean("playable", sourceUrl.isNotBlank()),
            teacherName = json.optString("teacherName").ifBlank { providerTitle(safeProvider) },
            imageUrl = json.optString("imageUrl"),
            order = json.optInt("order", 0),
            resourceLinks = parseResources(json),
        )
    }

    private fun parseResources(json: JSONObject): List<NativeResourceLink> =
        json.array("resourceLinks").mapObjects { resource ->
            NativeResourceLink(
                label = resource.optString("label").ifBlank { "Resource" },
                url = resource.optString("url"),
            )
        }.filter { it.url.isNotBlank() }

    private fun hierarchyFromClasses(classes: List<NativeExternalClass>): List<NativeExternalSection> =
        classes.groupBy { it.sectionTitle }.entries.mapIndexed { sectionIndex, sectionEntry ->
            val sectionClasses = sectionEntry.value
            NativeExternalSection(
                id = sectionClasses.firstOrNull()?.sectionId?.ifBlank { "legacy-section-$sectionIndex" } ?: "legacy-section-$sectionIndex",
                title = sectionEntry.key.ifBlank { "Classes" },
                description = "",
                order = sectionIndex,
                lectures = sectionClasses.groupBy { it.chapterTitle }.entries.mapIndexed { lectureIndex, lectureEntry ->
                    val lectureClasses = lectureEntry.value
                    NativeExternalLecture(
                        id = lectureClasses.firstOrNull()?.lectureId?.ifBlank { "legacy-lecture-$sectionIndex-$lectureIndex" }
                            ?: "legacy-lecture-$sectionIndex-$lectureIndex",
                        title = lectureEntry.key.ifBlank { "Lecture" },
                        description = "",
                        order = lectureIndex,
                        items = lectureClasses.map { classItem ->
                            NativeExternalContentItem(
                                id = classItem.id,
                                title = classItem.title,
                                topic = classItem.topic,
                                type = "Class",
                                linkType = "",
                                sourceUrl = classItem.sourceUrl,
                                playable = true,
                                teacherName = classItem.teacherName,
                                imageUrl = classItem.imageUrl,
                                order = classItem.order,
                                resourceLinks = classItem.resourceLinks,
                            )
                        },
                    )
                },
            )
        }

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
