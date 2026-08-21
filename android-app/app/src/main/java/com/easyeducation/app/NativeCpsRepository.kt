package com.easyeducation.app

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

private const val CPS_API_ORIGIN = "https://easy-education.vercel.app"
private const val CPS_PREFIX = "cps:"

data class NativeCpsLiveClass(
    val id: String,
    val title: String,
    val topic: String,
    val startTime: String,
    val url: String,
    val status: String,
    val platform: String,
    val thumbnailUrl: String,
)

data class NativeCpsExamSummary(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val date: String,
    val startTime: String,
    val endTime: String,
    val duration: Int,
    val questionsCount: Int,
    val maxScore: Double,
    val negativeMarks: Double,
)

data class NativeCpsQuestion(
    val id: String,
    val question: String,
    val questionImageUrl: String,
    val options: List<String>,
    val optionImageUrls: List<String>,
    val correctIndex: Int,
    val explanation: String,
)

data class NativeCpsCourseExtras(
    val liveClasses: List<NativeCpsLiveClass> = emptyList(),
    val exams: List<NativeCpsExamSummary> = emptyList(),
    val routines: String = "",
    val updates: String = "",
    val accessExpiresAtMs: Long = 0L,
)

data class NativeCpsCourseBundle(
    val content: NativeCourseContent,
    val extras: NativeCpsCourseExtras,
)

data class NativeCpsExamPayload(
    val exam: NativeCpsExamSummary,
    val questions: List<NativeCpsQuestion>,
)

class NativeCpsRepository {
    private val auth = FirebaseAuth.getInstance()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    suspend fun myCourses(): List<NativeCourse> {
        val payload = get("mine")
        return payload.optJSONArray("courses").objects().map(NativeCourse::from)
    }

    suspend fun loadCourse(courseId: String): NativeCpsCourseBundle {
        val rawCourseId = rawCourseId(courseId)
        val payload = get("course", mapOf("courseId" to rawCourseId))
        val course = payload.optJSONObject("course")?.let(NativeCourse::from)
            ?: error("CPS course data was empty")
        val classes = payload.optJSONArray("classes").objects()
            .map(NativeClassItem::from)
            .sortedWith(compareBy<NativeClassItem> { it.order }.thenBy { it.title })

        val subjects = classes
            .flatMap { it.subjects }
            .filter { it.isNotBlank() && !it.equals("archive", true) }
            .distinctBy { it.lowercase() }
            .mapIndexed { index, title ->
                NativeSubject(
                    id = "cps-subject:${stableTextId("$rawCourseId:$title")}",
                    courseId = course.id,
                    title = title,
                    order = index,
                )
            }

        val liveClasses = payload.optJSONArray("liveClasses").objects().map { item ->
            NativeCpsLiveClass(
                id = item.optString("id"),
                title = item.optString("title").ifBlank { "Live class" },
                topic = item.optString("topic"),
                startTime = item.optString("startTime"),
                url = item.optString("url"),
                status = item.optString("status", "upcoming"),
                platform = item.optString("platform"),
                thumbnailUrl = item.optString("thumbnailUrl"),
            )
        }
        val exams = payload.optJSONArray("exams").objects().map(::examSummary)
        return NativeCpsCourseBundle(
            content = NativeCourseContent(
                course = course,
                subjects = subjects,
                chapters = emptyList(),
                classes = classes,
            ),
            extras = NativeCpsCourseExtras(
                liveClasses = liveClasses,
                exams = exams,
                routines = payload.optString("routines"),
                updates = payload.optString("updates"),
                accessExpiresAtMs = payload.optLong("accessExpiresAtMs", 0L),
            ),
        )
    }

    suspend fun loadExam(courseId: String, examId: String): NativeCpsExamPayload {
        val payload = get(
            "exam",
            mapOf(
                "courseId" to rawCourseId(courseId),
                "examId" to examId,
            ),
        )
        val exam = payload.optJSONObject("exam")?.let(::examSummary)
            ?: error("CPS exam data was empty")
        val questions = payload.optJSONArray("questions").objects().map { item ->
            NativeCpsQuestion(
                id = item.optString("id"),
                question = item.optString("question"),
                questionImageUrl = item.optString("questionImageUrl"),
                options = item.optJSONArray("options").strings(),
                optionImageUrls = item.optJSONArray("optionImageUrls").strings(),
                correctIndex = item.optInt("correctIndex", -1),
                explanation = item.optString("explanation"),
            )
        }
        return NativeCpsExamPayload(exam, questions)
    }

    fun isCpsCourse(courseId: String): Boolean = courseId.startsWith(CPS_PREFIX)

    fun isAccessActive(extras: NativeCpsCourseExtras?, now: Long = System.currentTimeMillis()): Boolean {
        val expiresAt = extras?.accessExpiresAtMs ?: return false
        return expiresAt == 0L || expiresAt > now
    }

    private suspend fun get(action: String, params: Map<String, String> = emptyMap()): JSONObject {
        val user = auth.currentUser ?: error("Sign in to open CPS courses")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not get an authentication token")
        val query = buildList {
            add("action=${encode(action)}")
            params.forEach { (key, value) -> add("${encode(key)}=${encode(value)}") }
        }.joinToString("&")
        val request = Request.Builder()
            .url("$CPS_API_ORIGIN/api/cps?$query")
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

    private fun rawCourseId(courseId: String): String = courseId.removePrefix(CPS_PREFIX).trim()

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun examSummary(item: JSONObject) = NativeCpsExamSummary(
        id = item.optString("id"),
        title = item.optString("title").ifBlank { "Exam" },
        description = item.optString("description"),
        status = item.optString("status"),
        date = item.optString("date"),
        startTime = item.optString("startTime"),
        endTime = item.optString("endTime"),
        duration = item.optInt("duration", 0),
        questionsCount = item.optInt("questionsCount", 0),
        maxScore = item.optDouble("maxScore", 0.0),
        negativeMarks = item.optDouble("negativeMarks", 0.0),
    )

    private fun JSONArray?.objects(): List<JSONObject> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) optJSONObject(index)?.let(::add)
        }
    }

    private fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (index in 0 until length()) {
                val value = optString(index).trim()
                if (value.isNotBlank()) add(value)
            }
        }
    }

    private fun stableTextId(value: String): String {
        var hash = 1125899906842597L
        value.forEach { hash = 31L * hash + it.code }
        return java.lang.Long.toUnsignedString(hash, 36)
    }
}
