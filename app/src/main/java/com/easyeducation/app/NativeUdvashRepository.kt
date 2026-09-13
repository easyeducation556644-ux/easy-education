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
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    fun catalog(): List<NativeUdvashCourse> {
        val root = request("$APP_ORIGIN/api/udvash?action=catalog")
        return root.array("courses").mapObjects { json ->
            NativeUdvashCourse(
                id = json.optString("id"),
                title = json.optString("title").ifBlank { "Udvash Course" },
                iconPath = json.optString("iconPath"),
                rank = json.optInt("rank", 0),
                accessType = json.optString("accessType", "premium"),
                accessExpiresAtMs = json.optLong("accessExpiresAtMs", 0L),
            )
        }
    }

    fun subjects(courseId: String): List<NativeUdvashSubject> {
        val root = request(url("subjects", courseId))
        return root.array("subjects").mapObjects { json ->
            NativeUdvashSubject(
                id = json.optInt("subjectId"),
                name = json.optString("name").ifBlank { json.optString("shortName").ifBlank { "Subject" } },
                shortName = json.optString("shortName"),
                iconPath = json.optString("iconPath"),
                rank = json.optInt("rank", 0),
                chapterCount = json.optInt("chapterCount", 0),
            )
        }.sortedWith(compareBy<NativeUdvashSubject> { it.rank }.thenBy { it.name })
    }

    fun chapters(courseId: String, subjectId: Int): List<NativeUdvashChapter> {
        val root = request("${url("chapters", courseId)}&subjectId=$subjectId")
        return root.array("chapters").mapObjects { json ->
            NativeUdvashChapter(
                id = json.optInt("masterChapterId"),
                name = json.optString("name"),
                displayNameBn = json.optString("displayNameBn"),
                displayNameEn = json.optString("displayNameEn"),
                rank = json.optInt("rank", 0),
            )
        }.sortedWith(compareBy<NativeUdvashChapter> { it.rank }.thenBy { it.name })
    }

    fun contentTypes(courseId: String, subjectId: Int, chapterId: Int): List<NativeUdvashContentType> {
        val root = request("${url("content-types", courseId)}&subjectId=$subjectId&chapterId=$chapterId")
        return root.array("contentTypes").mapObjects { json ->
            NativeUdvashContentType(
                id = json.optInt("masterContentTypeId"),
                title = json.optString("displayName").ifBlank { "Classes" },
                totalContentCount = json.optInt("totalContentCount", 0),
                rank = json.optInt("rank", 0),
            )
        }.sortedWith(compareBy<NativeUdvashContentType> { it.rank }.thenBy { it.title })
    }

    fun cards(courseId: String, subjectId: Int, chapterId: Int, contentTypeId: Int): List<NativeUdvashCard> {
        val root = request("${url("cards", courseId)}&subjectId=$subjectId&chapterId=$chapterId&contentTypeId=$contentTypeId")
        return root.array("cards").mapObjects { json ->
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
    }

    fun classDetail(
        courseId: String,
        subjectId: Int,
        chapterId: Int,
        contentTypeId: Int,
        contentId: Int,
    ): NativeUdvashClassDetail {
        val root = request(
            "${url("class", courseId)}&subjectId=$subjectId&chapterId=$chapterId&contentTypeId=$contentTypeId&contentId=$contentId",
        )
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

    private fun request(url: String): JSONObject {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in to open Udvash")
        val idToken = Tasks.await(user.getIdToken(false)).token ?: error("Could not refresh your login")
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $idToken")
            .header("Accept", "application/json")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse { error("Udvash returned an invalid response") }
            if (!response.isSuccessful) {
                error(json.optString("error").ifBlank { "Udvash request failed (${response.code})" })
            }
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
    }
}
