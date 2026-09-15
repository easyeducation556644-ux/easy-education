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

data class NativeUdvashCourse(
    val id: String,
    val title: String,
    val iconPath: String,
    val rank: Int,
    val accessType: String,
    val accessExpiresAtMs: Long,
)

data class NativeUdvashSubject(
    val id: Int,
    val name: String,
    val shortName: String,
    val iconPath: String,
    val rank: Int,
    val chapterCount: Int,
)

data class NativeUdvashChapter(
    val id: Int,
    val name: String,
    val displayNameBn: String,
    val displayNameEn: String,
    val rank: Int,
)

data class NativeUdvashContentType(
    val id: Int,
    val title: String,
    val totalContentCount: Int,
    val rank: Int,
)

data class NativeUdvashCard(
    val id: Int,
    val title: String,
    val description: String,
    val hasVideo: Boolean,
    val hasNotes: Boolean,
    val hasQuiz: Boolean,
    val isBlocked: Boolean,
    val rank: Int,
)

data class NativeUdvashVideoOption(
    val resolution: Int,
    val url: String,
    val sizeMBOrGB: Double,
)

data class NativeUdvashNote(
    val id: Int,
    val label: String,
    val url: String,
    val fileSizeKB: Double,
)

data class NativeUdvashLiveClass(
    val sourceAccountId: String,
    val lectureId: Int,
    val isInteractiveClass: Boolean,
    val lectureType: Int,
    val subjectName: String,
    val lectureName: String,
    val syllabusHtml: String,
    val courseId: Int,
    val routineId: Int,
    val studentProgramId: Long,
    val isLive: Boolean,
    val startDateTime: String,
    val endDateTime: String,
    val programSessionName: String,
    val courseName: String,
    val isServiceBlocked: Boolean,
)

data class NativeUdvashLiveSnapshot(
    val totalLiveClass: Int,
    val totalUpcomingClass: Int,
    val joinButtonBeforeMinutes: Int,
    val classes: List<NativeUdvashLiveClass>,
)

data class NativeUdvashJoinResult(
    val contentUrl: String,
    val qnaUrl: String,
    val registrationNo: String,
)

data class NativeUdvashClassDetail(
    val masterCourseId: Int,
    val subjectId: Int,
    val masterChapterId: Int,
    val masterContentId: Int,
    val masterContentTypeId: Int,
    val courseName: String,
    val subjectName: String,
    val chapterName: String,
    val title: String,
    val description: String,
    val hasVideo: Boolean,
    val hasNotes: Boolean,
    val hasPrevious: Boolean,
    val hasNext: Boolean,
    val videoOptions: List<NativeUdvashVideoOption>,
    val youtubeUrl: String,
    val notes: List<NativeUdvashNote>,
)

class NativeUdvashRepository(context: Context) {
    private val appContext = context.applicationContext
    private val cache = appContext.getSharedPreferences("udvash_route_cache_v2", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    fun catalog(cachedOnly: Boolean = false): List<NativeUdvashCourse> =
        parseCatalog(payload("catalog", "$APP_ORIGIN/api/udvash?action=catalog", cachedOnly))

    fun subjects(courseId: String, cachedOnly: Boolean = false): List<NativeUdvashSubject> =
        parseSubjects(payload("subjects:$courseId", url("subjects", courseId), cachedOnly))

    fun chapters(courseId: String, subjectId: Int, cachedOnly: Boolean = false): List<NativeUdvashChapter> =
        parseChapters(
            payload(
                "chapters:$courseId:$subjectId",
                "${url("chapters", courseId)}&subjectId=$subjectId",
                cachedOnly,
            ),
        )

    fun contentTypes(
        courseId: String,
        subjectId: Int,
        chapterId: Int,
        cachedOnly: Boolean = false,
    ): List<NativeUdvashContentType> = parseContentTypes(
        payload(
            "types:$courseId:$subjectId:$chapterId",
            "${url("content-types", courseId)}&subjectId=$subjectId&chapterId=$chapterId",
            cachedOnly,
        ),
    )

    fun cards(
        courseId: String,
        subjectId: Int,
        chapterId: Int,
        contentTypeId: Int,
        cachedOnly: Boolean = false,
    ): List<NativeUdvashCard> = parseCards(
        payload(
            "cards:$courseId:$subjectId:$chapterId:$contentTypeId",
            "${url("cards", courseId)}&subjectId=$subjectId&chapterId=$chapterId&contentTypeId=$contentTypeId",
            cachedOnly,
        ),
    )

    fun liveClasses(cachedOnly: Boolean = false): NativeUdvashLiveSnapshot =
        parseLiveClasses(payload("live-classes", "$APP_ORIGIN/api/udvash?action=live-classes", cachedOnly))

    fun joinLiveClass(
        sourceAccountId: String,
        courseId: Int,
        routineId: Int,
        studentProgramId: Long,
    ): NativeUdvashJoinResult {
        val target = buildString {
            append("$APP_ORIGIN/api/udvash?action=join-live")
            append("&sourceAccountId=").append(URLEncoder.encode(sourceAccountId, Charsets.UTF_8.name()))
            append("&courseId=").append(courseId)
            append("&routineId=").append(routineId)
            append("&studentProgramId=").append(studentProgramId)
        }
        return parseJoinResult(request(target))
    }

    fun classDetail(
        courseId: String,
        subjectId: Int,
        chapterId: Int,
        contentTypeId: Int,
        contentId: Int,
        cachedOnly: Boolean = false,
    ): NativeUdvashClassDetail = parseClassDetail(
        payload(
            "class:$courseId:$subjectId:$chapterId:$contentTypeId:$contentId",
            "${url("class", courseId)}&subjectId=$subjectId&chapterId=$chapterId&contentTypeId=$contentTypeId&contentId=$contentId",
            cachedOnly,
        ),
    )

    fun cachedLiveClasses(): NativeUdvashLiveSnapshot? = runCatching { liveClasses(true) }.getOrNull()
    fun cachedCatalog(): List<NativeUdvashCourse> = runCatching { catalog(true) }.getOrDefault(emptyList())
    fun cachedSubjects(courseId: String): List<NativeUdvashSubject> = runCatching { subjects(courseId, true) }.getOrDefault(emptyList())
    fun cachedChapters(courseId: String, subjectId: Int): List<NativeUdvashChapter> =
        runCatching { chapters(courseId, subjectId, true) }.getOrDefault(emptyList())
    fun cachedContentTypes(courseId: String, subjectId: Int, chapterId: Int): List<NativeUdvashContentType> =
        runCatching { contentTypes(courseId, subjectId, chapterId, true) }.getOrDefault(emptyList())
    fun cachedCards(courseId: String, subjectId: Int, chapterId: Int, contentTypeId: Int): List<NativeUdvashCard> =
        runCatching { cards(courseId, subjectId, chapterId, contentTypeId, true) }.getOrDefault(emptyList())
    fun cachedClassDetail(courseId: String, subjectId: Int, chapterId: Int, contentTypeId: Int, contentId: Int): NativeUdvashClassDetail? =
        runCatching { classDetail(courseId, subjectId, chapterId, contentTypeId, contentId, true) }.getOrNull()

    private fun parseCatalog(root: JSONObject): List<NativeUdvashCourse> = root.array("courses").mapObjects { json ->
        NativeUdvashCourse(
            id = json.optString("id"),
            title = json.optString("title").ifBlank { "Udvash Course" },
            iconPath = json.optString("iconPath"),
            rank = json.optInt("rank", 0),
            accessType = json.optString("accessType", "premium"),
            accessExpiresAtMs = json.optLong("accessExpiresAtMs", 0L),
        )
    }.sortedWith(compareBy<NativeUdvashCourse> { it.rank }.thenBy { it.title })

    private fun parseSubjects(root: JSONObject): List<NativeUdvashSubject> = root.array("subjects").mapObjects { json ->
        NativeUdvashSubject(
            id = json.optInt("subjectId"),
            name = json.optString("name").ifBlank { json.optString("shortName").ifBlank { "Subject" } },
            shortName = json.optString("shortName"),
            iconPath = json.optString("iconPath"),
            rank = json.optInt("rank", 0),
            chapterCount = json.optInt("chapterCount", 0),
        )
    }.sortedWith(compareBy<NativeUdvashSubject> { it.rank }.thenBy { it.name })

    private fun parseChapters(root: JSONObject): List<NativeUdvashChapter> = root.array("chapters").mapObjects { json ->
        NativeUdvashChapter(
            id = json.optInt("masterChapterId"),
            name = json.optString("name"),
            displayNameBn = json.optString("displayNameBn"),
            displayNameEn = json.optString("displayNameEn"),
            rank = json.optInt("rank", 0),
        )
    }.sortedWith(compareBy<NativeUdvashChapter> { it.rank }.thenBy { it.name })

    private fun parseContentTypes(root: JSONObject): List<NativeUdvashContentType> = root.array("contentTypes").mapObjects { json ->
        NativeUdvashContentType(
            id = json.optInt("masterContentTypeId"),
            title = json.optString("displayName").ifBlank { "Classes" },
            totalContentCount = json.optInt("totalContentCount", 0),
            rank = json.optInt("rank", 0),
        )
    }.sortedWith(compareBy<NativeUdvashContentType> { it.rank }.thenBy { it.title })

    private fun parseCards(root: JSONObject): List<NativeUdvashCard> = root.array("cards").mapObjects { json ->
        NativeUdvashCard(
            id = json.optInt("masterContentId"),
            title = json.optString("title").ifBlank { "Class" },
            description = json.optString("description"),
            hasVideo = json.optBoolean("hasVideo", false),
            hasNotes = json.optBoolean("hasNotes", false),
            hasQuiz = json.optBoolean("hasQuiz", false),
            isBlocked = json.optBoolean("isBlocked", false),
            rank = json.optInt("rank", 0),
        )
    }.sortedWith(compareBy<NativeUdvashCard> { it.rank }.thenBy { it.title })

    private fun parseLiveClasses(root: JSONObject): NativeUdvashLiveSnapshot = NativeUdvashLiveSnapshot(
        totalLiveClass = root.optInt("totalLiveClass", 0),
        totalUpcomingClass = root.optInt("totalUpcomingClass", 0),
        joinButtonBeforeMinutes = root.optInt("joinButtonBeforeMinutes", 10),
        classes = root.array("classes").mapObjects { json ->
            NativeUdvashLiveClass(
                sourceAccountId = json.optString("sourceAccountId"),
                lectureId = json.optInt("lectureId"),
                isInteractiveClass = json.optBoolean("isInteractiveClass", false),
                lectureType = json.optInt("lectureType"),
                subjectName = json.optString("subjectName"),
                lectureName = json.optString("lectureName").ifBlank { "Udvash Live Class" },
                syllabusHtml = json.optString("syllabusHtml"),
                courseId = json.optInt("courseId"),
                routineId = json.optInt("routineId"),
                studentProgramId = json.optLong("studentProgramId"),
                isLive = json.optBoolean("isLive", false),
                startDateTime = json.optString("startDateTime"),
                endDateTime = json.optString("endDateTime"),
                programSessionName = json.optString("programSessionName"),
                courseName = json.optString("courseName"),
                isServiceBlocked = json.optBoolean("isServiceBlocked", false),
            )
        },
    )

    private fun parseJoinResult(root: JSONObject): NativeUdvashJoinResult = NativeUdvashJoinResult(
        contentUrl = root.optString("contentUrl"),
        qnaUrl = root.optString("qnaUrl"),
        registrationNo = root.optString("registrationNo"),
    )

    private fun parseClassDetail(root: JSONObject): NativeUdvashClassDetail {
        val json = root.optJSONObject("detail") ?: error("Udvash class details are unavailable")
        return NativeUdvashClassDetail(
            masterCourseId = json.optInt("masterCourseId"),
            subjectId = json.optInt("subjectId"),
            masterChapterId = json.optInt("masterChapterId"),
            masterContentId = json.optInt("masterContentId"),
            masterContentTypeId = json.optInt("masterContentTypeId"),
            courseName = json.optString("courseName"),
            subjectName = json.optString("subjectName"),
            chapterName = json.optString("chapterName"),
            title = json.optString("title").ifBlank { "Udvash Class" },
            description = json.optString("description"),
            hasVideo = json.optBoolean("hasVideo", false),
            hasNotes = json.optBoolean("hasNotes", false),
            hasPrevious = json.optBoolean("hasPrevious", false),
            hasNext = json.optBoolean("hasNext", false),
            videoOptions = json.array("videoOptions").mapObjects { variant ->
                NativeUdvashVideoOption(
                    resolution = variant.optInt("resolution", 0),
                    url = variant.optString("url"),
                    sizeMBOrGB = variant.optDouble("sizeMBOrGB", 0.0),
                )
            }.filter { it.url.isNotBlank() }.sortedByDescending { it.resolution },
            youtubeUrl = json.optString("youtubeUrl"),
            notes = json.array("notes").mapObjects { note ->
                NativeUdvashNote(
                    id = note.optInt("id"),
                    label = note.optString("label").ifBlank { "Class note" },
                    url = note.optString("url"),
                    fileSizeKB = note.optDouble("fileSizeKB", 0.0),
                )
            }.filter { it.url.isNotBlank() },
        )
    }

    private fun url(action: String, courseId: String): String =
        "$APP_ORIGIN/api/udvash?action=$action&courseId=${URLEncoder.encode(courseId.trim(), Charsets.UTF_8.name())}"

    private fun payload(cacheKey: String, url: String, cachedOnly: Boolean): JSONObject {
        val scopedKey = scopedCacheKey(cacheKey)
        if (cachedOnly) {
            val raw = cache.getString(scopedKey, null) ?: error("No cached Udvash data")
            return runCatching { JSONObject(raw) }.getOrElse { error("Cached Udvash data is invalid") }
        }
        val fresh = request(url)
        cache.edit().putString(scopedKey, fresh.toString()).apply()
        return fresh
    }

    private fun scopedCacheKey(key: String): String {
        val uid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty().ifBlank { "anonymous" }
        return "$uid:$key"
    }

    private fun request(url: String): JSONObject {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in to open Udvash")
        fun execute(forceRefresh: Boolean): Pair<Int, String> {
            val token = Tasks.await(user.getIdToken(forceRefresh)).token ?: error("Could not refresh your login")
            val request = Request.Builder().url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .get().build()
            return http.newCall(request).execute().use { response -> response.code to response.body?.string().orEmpty() }
        }
        var (code, raw) = execute(false)
        if (code == 401) {
            val retried = execute(true)
            code = retried.first
            raw = retried.second
        }
        val json = runCatching { JSONObject(raw) }.getOrElse { error("Udvash returned an invalid response") }
        if (code !in 200..299) error(json.optString("error").ifBlank { "Udvash request failed ($code)" })
        return json
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

        fun virtualClassSource(
            courseId: String,
            subjectId: Int,
            chapterId: Int,
            contentTypeId: Int,
            contentId: Int,
        ): String = buildString {
            append("udvash://class?")
            append("courseId=").append(UriCodec.encode(courseId))
            append("&subjectId=").append(subjectId)
            append("&chapterId=").append(chapterId)
            append("&contentTypeId=").append(contentTypeId)
            append("&contentId=").append(contentId)
        }
    }
}

private object UriCodec {
    fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
