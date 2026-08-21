package com.easyeducation.app

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
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

    suspend fun refresh(): List<NativeCpsExamResult> {
        val uid = auth.currentUser?.uid ?: error("Sign in to view exam results")
        val payload = request("mine", null)
        prefs.edit().putString("results:$uid", payload.toString()).apply()
        return parseResults(payload)
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

    private suspend fun request(action: String, body: JSONObject?): JSONObject {
        val user = auth.currentUser ?: error("Sign in to continue")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your session")
        val builder = Request.Builder()
            .url("$EXAM_RESULTS_API?action=$action")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
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

    private fun parseResults(payload: JSONObject): List<NativeCpsExamResult> {
        val array = payload.optJSONArray("results") ?: JSONArray()
        return buildList {
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let { add(parseResult(it)) }
            }
        }.sortedByDescending { it.submittedAtMs }
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
        marks = item.optDouble("marks", 0.0),
        maxScore = item.optDouble("maxScore", 0.0),
        negativeMarks = item.optDouble("negativeMarks", 0.0),
        questionCount = item.optInt("questionCount", 0),
    )
}
