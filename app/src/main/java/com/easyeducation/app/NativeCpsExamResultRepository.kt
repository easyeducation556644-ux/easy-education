package com.easyeducation.app

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val EXAM_RESULTS_API = "https://easy-education.vercel.app/api/exam-results"
private const val EXAM_RESULTS_PREFS = "cps_exam_results_v1"

data class NativeCpsExamResult(
    val id: String,
    val courseId: String,
    val courseTitle: String,
    val examId: String,
    val examTitle: String,
    val startedAtMs: Long,
    val submittedAtMs: Long,
    val timeTakenSeconds: Int,
    val answered: Int,
    val correct: Int,
    val wrong: Int,
    val unanswered: Int,
    val marks: Double,
    val maxScore: Double,
    val negativeMarks: Double,
    val questionCount: Int,
)

data class NativeCpsExamAnswerResult(
    val questionId: String,
    val selectedIndex: Int,
    val correctIndex: Int,
    val isCorrect: Boolean,
)

data class NativeCpsExamResultDraft(
    val courseId: String,
    val courseTitle: String,
    val examId: String,
    val examTitle: String,
    val startedAtMs: Long,
    val timeTakenSeconds: Int,
    val answered: Int,
    val correct: Int,
    val wrong: Int,
    val unanswered: Int,
    val marks: Double,
    val maxScore: Double,
    val negativeMarks: Double,
    val questionCount: Int,
    val answers: List<NativeCpsExamAnswerResult>,
)

data class NativeCpsLeaderboardRow(
    val rank: Int,
    val userName: String,
    val marks: Double,
    val maxScore: Double,
    val correct: Int,
    val wrong: Int,
    val answered: Int,
    val timeTakenSeconds: Int,
    val submittedAtMs: Long,
    val isYou: Boolean,
)

data class NativeCpsExamOverview(
    val attempts: List<NativeCpsExamResult>,
    val firstAttempt: NativeCpsExamResult?,
    val retakeCount: Int,
    val leaderboard: List<NativeCpsLeaderboardRow>,
    val firstAttemptOnly: Boolean = true,
)

class NativeCpsExamResultRepository(context: Context) {
    private val appContext = context.applicationContext
    private val auth = FirebaseAuth.getInstance()
    private val prefs = appContext.getSharedPreferences(EXAM_RESULTS_PREFS, Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    fun cached(uid: String = auth.currentUser?.uid.orEmpty()): List<NativeCpsExamResult> {
        if (uid.isBlank()) return emptyList()
        val raw = prefs.getString("results:$uid", null) ?: return emptyList()
        return runCatching { parseResults(JSONObject(raw)) }.getOrDefault(emptyList())
    }

    fun cachedExamOverview(
        courseId: String,
        examId: String,
        uid: String = auth.currentUser?.uid.orEmpty(),
    ): NativeCpsExamOverview {
        if (uid.isBlank() || examId.isBlank()) return NativeCpsExamOverview(emptyList(), null, 0, emptyList())
        val key = overviewCacheKey(uid, courseId, examId)
        prefs.getString(key, null)?.let { raw ->
            runCatching { parseOverview(JSONObject(raw)) }.getOrNull()?.let { return it }
        }
        val normalizedCourse = courseId.removePrefix("cps:")
        val attempts = cached(uid)
            .filter { it.examId == examId && it.courseId.removePrefix("cps:") == normalizedCourse }
            .sortedWith(compareBy<NativeCpsExamResult> { attemptMoment(it) }.thenBy { it.id })
        return NativeCpsExamOverview(
            attempts = attempts,
            firstAttempt = attempts.firstOrNull(),
            retakeCount = (attempts.size - 1).coerceAtLeast(0),
            leaderboard = emptyList(),
        )
    }

    suspend fun refresh(): List<NativeCpsExamResult> {
        val uid = auth.currentUser?.uid ?: error("Sign in to view exam results")
        val payload = request("mine", null)
        val parsed = parseResults(payload)
        prefs.edit().putString("results:$uid", payload.toString()).apply()
        return parsed
    }

    suspend fun examOverview(
        courseId: String,
        examId: String,
        examTitle: String = "",
        maxScore: Double = 0.0,
        questionCount: Int = 0,
    ): NativeCpsExamOverview {
        val uid = auth.currentUser?.uid ?: error("Sign in to view exam attempts")
        val query = linkedMapOf(
            "courseId" to courseId.removePrefix("cps:"),
            "examId" to examId,
            "examTitle" to examTitle,
            "maxScore" to maxScore.toString(),
            "questionCount" to questionCount.toString(),
        )
        val payload = request("exam", null, query, includeCpsSession = true)
        val parsed = parseOverview(payload)
        prefs.edit().putString(overviewCacheKey(uid, courseId, examId), payload.toString()).apply()
        return parsed
    }

    suspend fun save(draft: NativeCpsExamResultDraft): NativeCpsExamResult {
        val payload = JSONObject()
            .put("action", "save")
            .put("courseId", draft.courseId)
            .put("courseTitle", draft.courseTitle)
            .put("examId", draft.examId)
            .put("examTitle", draft.examTitle)
            .put("startedAtMs", draft.startedAtMs)
            .put("timeTakenSeconds", draft.timeTakenSeconds)
            .put("answered", draft.answered)
            .put("correct", draft.correct)
            .put("wrong", draft.wrong)
            .put("unanswered", draft.unanswered)
            .put("marks", draft.marks)
            .put("maxScore", draft.maxScore)
            .put("negativeMarks", draft.negativeMarks)
            .put("questionCount", draft.questionCount)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("answers", JSONArray().apply {
                draft.answers.forEach { answer ->
                    put(
                        JSONObject()
                            .put("questionId", answer.questionId)
                            .put("selectedIndex", answer.selectedIndex)
                            .put("correctIndex", answer.correctIndex)
                            .put("isCorrect", answer.isCorrect),
                    )
                }
            })
        val response = request("save", payload)
        val result = response.optJSONObject("result")?.let(::parseResult)
            ?: error("Exam result could not be saved")
        runCatching { refresh() }
        return result
    }

    private suspend fun request(
        action: String,
        body: JSONObject?,
        query: Map<String, String> = emptyMap(),
        includeCpsSession: Boolean = false,
    ): JSONObject {
        val user = auth.currentUser ?: error("Sign in to continue")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your session")
        val url = EXAM_RESULTS_API.toHttpUrl().newBuilder()
            .addQueryParameter("action", action)
            .apply {
                query.forEach { (key, value) ->
                    if (value.isNotBlank()) addQueryParameter(key, value)
                }
            }
            .build()
        val builder = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
        if (includeCpsSession) {
            CpsFirebaseSession.sourceIdToken(appContext, forceRefresh = true)
                ?.takeIf { it.isNotBlank() }
                ?.let { builder.header("X-CPS-Firebase-Token", it) }
        }
        if (body == null) builder.get()
        else builder.post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("Content-Type", "application/json")
        return withContext(Dispatchers.IO) {
            http.newCall(builder.build()).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
                if (!response.isSuccessful) {
                    error(json.optString("error").ifBlank { "Exam result service is temporarily unavailable" })
                }
                json
            }
        }
    }

    /**
     * Result ids from older server rows are not guaranteed to be present or unique. Compose
     * lists require unique keys. Normalize every row before it reaches UI and skip a malformed row
     * instead of taking down the whole attempt screen.
     */
    private fun parseResults(payload: JSONObject): List<NativeCpsExamResult> =
        parseResultArray(payload.optJSONArray("results")).sortedByDescending { it.submittedAtMs }

    private fun parseResultArray(array: JSONArray?): List<NativeCpsExamResult> {
        if (array == null) return emptyList()
        val seen = HashSet<String>()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val result = runCatching { parseResult(item) }.getOrNull() ?: continue
                val seed = result.id.trim().ifBlank {
                    listOf(
                        result.examId.ifBlank { "exam" },
                        result.submittedAtMs.toString(),
                        result.startedAtMs.toString(),
                        index.toString(),
                    ).joinToString(":")
                }
                var unique = seed
                var suffix = 1
                while (!seen.add(unique)) {
                    unique = "$seed:$suffix"
                    suffix += 1
                }
                add(if (unique == result.id) result else result.copy(id = unique))
            }
        }
    }

    private fun parseOverview(payload: JSONObject): NativeCpsExamOverview {
        val attempts = parseResultArray(payload.optJSONArray("attempts"))
            .sortedWith(compareBy<NativeCpsExamResult> { attemptMoment(it) }.thenBy { it.id })
        val first = payload.optJSONObject("firstAttempt")?.let {
            runCatching { parseResult(it) }.getOrNull()
        } ?: attempts.firstOrNull()
        val leaderboardJson = payload.optJSONArray("leaderboard")
        val leaderboard = buildList {
            if (leaderboardJson != null) {
                for (index in 0 until leaderboardJson.length()) {
                    val item = leaderboardJson.optJSONObject(index) ?: continue
                    add(
                        NativeCpsLeaderboardRow(
                            rank = item.optInt("rank", index + 1).coerceAtLeast(1),
                            userName = item.optString("userName").ifBlank { "Student" },
                            marks = finiteDouble(item, "marks"),
                            maxScore = finiteDouble(item, "maxScore").coerceAtLeast(0.0),
                            correct = item.optInt("correct", 0).coerceAtLeast(0),
                            wrong = item.optInt("wrong", 0).coerceAtLeast(0),
                            answered = item.optInt("answered", 0).coerceAtLeast(0),
                            timeTakenSeconds = item.optInt("timeTakenSeconds", 0).coerceAtLeast(0),
                            submittedAtMs = item.optLong("submittedAtMs", 0L).coerceAtLeast(0L),
                            isYou = item.optBoolean("isYou", false),
                        ),
                    )
                }
            }
        }
        val rule = payload.optJSONObject("leaderboardRule")
        return NativeCpsExamOverview(
            attempts = attempts,
            firstAttempt = first,
            retakeCount = payload.optInt("retakeCount", (attempts.size - 1).coerceAtLeast(0)).coerceAtLeast(0),
            leaderboard = leaderboard,
            firstAttemptOnly = rule?.optString("attemptsUsed").orEmpty().ifBlank { "first-only" } == "first-only",
        )
    }

    private fun parseResult(item: JSONObject) = NativeCpsExamResult(
        id = item.optString("id"),
        courseId = item.optString("courseId"),
        courseTitle = item.optString("courseTitle"),
        examId = item.optString("examId"),
        examTitle = item.optString("examTitle").ifBlank { "CPS Exam" },
        startedAtMs = item.optLong("startedAtMs", 0L),
        submittedAtMs = item.optLong("submittedAtMs", 0L),
        timeTakenSeconds = item.optInt("timeTakenSeconds", 0),
        answered = item.optInt("answered", 0),
        correct = item.optInt("correct", 0),
        wrong = item.optInt("wrong", 0),
        unanswered = item.optInt("unanswered", 0),
        marks = finiteDouble(item, "marks"),
        maxScore = finiteDouble(item, "maxScore"),
        negativeMarks = finiteDouble(item, "negativeMarks"),
        questionCount = item.optInt("questionCount", 0),
    )

    private fun finiteDouble(item: JSONObject, key: String): Double =
        item.optDouble(key, 0.0).takeIf { it.isFinite() } ?: 0.0

    private fun overviewCacheKey(uid: String, courseId: String, examId: String): String =
        "exam:$uid:${courseId.removePrefix("cps:")}:$examId"

    private fun attemptMoment(item: NativeCpsExamResult): Long = when {
        item.submittedAtMs > 0L -> item.submittedAtMs
        item.startedAtMs > 0L -> item.startedAtMs
        else -> Long.MAX_VALUE
    }
}
