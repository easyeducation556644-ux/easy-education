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

private const val CPS_ROUTINE_CACHE = "cps_routine_sheet"
private const val CPS_ROUTINE_API = "https://easy-education.vercel.app/api/cps"

data class NativeCpsRoutineSheet(
    val mode: String = "",
    val rows: List<List<String>> = emptyList(),
    val text: String = "",
)

class NativeCpsRoutineRepository(context: Context) {
    private val appContext = context.applicationContext
    private val cache = NativeCacheDb(appContext)
    private val auth = FirebaseAuth.getInstance()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    fun cached(courseId: String): NativeCpsRoutineSheet? {
        val rawId = courseId.removePrefix("cps:")
        val payload = cache.getDoc(CPS_ROUTINE_CACHE, rawId) ?: return null
        return runCatching { parse(payload) }.getOrNull()
    }

    suspend fun refresh(courseId: String): NativeCpsRoutineSheet {
        val rawId = courseId.removePrefix("cps:")
        val user = auth.currentUser ?: error("Sign in to open the routine")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your session")
        val cpsToken = runCatching { CpsFirebaseSession.sourceIdToken(appContext, false) }.getOrNull()
        val encoded = URLEncoder.encode(rawId, Charsets.UTF_8.name())
        val request = Request.Builder()
            .url("$CPS_ROUTINE_API?action=routine&courseId=$encoded")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
            .apply { if (!cpsToken.isNullOrBlank()) header("X-CPS-Firebase-Token", cpsToken) }
            .get()
            .build()

        val payload = withContext(Dispatchers.IO) {
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(body) }.getOrDefault(JSONObject())
                if (!response.isSuccessful) error(json.optString("error").ifBlank { "Routine is temporarily unavailable" })
                json
            }
        }
        withContext(Dispatchers.IO) { cache.putDoc(CPS_ROUTINE_CACHE, rawId, payload) }
        return parse(payload)
    }

    private fun parse(payload: JSONObject): NativeCpsRoutineSheet {
        val rows = buildList {
            val rawRows = payload.optJSONArray("rows") ?: JSONArray()
            for (rowIndex in 0 until rawRows.length()) {
                val rawRow = rawRows.optJSONArray(rowIndex) ?: continue
                val cells = buildList {
                    for (cellIndex in 0 until rawRow.length()) {
                        val value = rawRow.optString(cellIndex).trim()
                        if (value.isNotBlank()) add(value)
                    }
                }
                if (cells.isNotEmpty()) add(cells)
            }
        }
        return NativeCpsRoutineSheet(
            mode = payload.optString("mode"),
            rows = rows,
            text = payload.optString("text"),
        )
    }
}
