package com.easyeducation.app

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Sends an app-only FCM notification to the author of the comment being replied to. */
object NativeCommentReplyPush {
    private const val ENDPOINT = "https://easy-education.vercel.app/api/comment-reply-push"
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    suspend fun send(
        parentCommentId: String,
        classId: String,
        courseId: String,
        classTitle: String,
        replyText: String,
    ): Result<Unit> = runCatching {
        val user = FirebaseAuth.getInstance().currentUser ?: return@runCatching
        val idToken = user.getIdToken(false).await().token.orEmpty()
        if (idToken.isBlank()) return@runCatching
        val body = JSONObject()
            .put("parentCommentId", parentCommentId)
            .put("classId", classId)
            .put("courseId", courseId)
            .put("classTitle", classTitle.take(180))
            .put("replyText", replyText.take(500))
            .toString()
            .toRequestBody(JSON)
        withContext(Dispatchers.IO) {
            http.newCall(
                Request.Builder()
                    .url(ENDPOINT)
                    .header("Authorization", "Bearer $idToken")
                    .post(body)
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) {
                    val detail = runCatching {
                        JSONObject(response.body?.string().orEmpty()).optString("error")
                    }.getOrNull().orEmpty()
                    error(detail.ifBlank { "Reply notification failed (${response.code})" })
                }
            }
        }
    }
}
