package com.easyeducation.app

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val TRIAL_API = "https://easy-education.vercel.app/api/trials"
private const val TRIAL_PREFS = "native_trial_offers_v1"


data class NativeTrialCourseTarget(
    val source: String,
    val courseId: String,
    val title: String,
)

data class NativeTrialOffer(
    val id: String,
    val title: String,
    val durationValue: Double,
    val durationUnit: String,
    val durationMs: Long,
    val courseTargets: List<NativeTrialCourseTarget>,
    val status: String,
    val claimedAtMs: Long = 0L,
    val expiresAtMs: Long = 0L,
    val cancelledAtMs: Long = 0L,
) {
    val isPending: Boolean get() = status.equals("pending", ignoreCase = true)
    val isActive: Boolean get() = status.equals("claimed", ignoreCase = true) && (expiresAtMs == 0L || expiresAtMs > System.currentTimeMillis())
}

private class NativeTrialRepository(context: Context) {
    private val appContext = context.applicationContext
    private val auth = FirebaseAuth.getInstance()
    private val prefs = appContext.getSharedPreferences(TRIAL_PREFS, Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    fun cached(uid: String): List<NativeTrialOffer> {
        if (uid.isBlank()) return emptyList()
        val raw = prefs.getString("offers:$uid", null) ?: return emptyList()
        return runCatching { parseOffers(JSONObject(raw)) }.getOrDefault(emptyList())
    }

    suspend fun mine(uid: String): List<NativeTrialOffer> {
        val payload = request("mine")
        prefs.edit().putString("offers:$uid", payload.toString()).apply()
        return parseOffers(payload)
    }

    suspend fun claim(uid: String, campaignId: String): List<NativeTrialOffer> {
        request("claim", campaignId)
        return mine(uid)
    }

    suspend fun cancel(uid: String, campaignId: String): List<NativeTrialOffer> {
        request("cancel", campaignId)
        return mine(uid)
    }

    fun clear(uid: String) {
        prefs.edit().remove("offers:$uid").apply()
    }

    private suspend fun request(action: String, campaignId: String? = null): JSONObject {
        val user = auth.currentUser ?: error("Sign in to manage your trial")
        val token = user.getIdToken(false).await().token?.takeIf { it.isNotBlank() }
            ?: error("Could not verify your session")
        val builder = Request.Builder()
            .url("$TRIAL_API?action=$action")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("User-Agent", "EasyEducationAndroid/${BuildConfig.VERSION_NAME}")
        if (campaignId == null) {
            builder.get()
        } else {
            val body = JSONObject().put("action", action).put("campaignId", campaignId).toString()
                .toRequestBody("application/json".toMediaType())
            builder.post(body).header("Content-Type", "application/json")
        }
        return withContext(Dispatchers.IO) {
            http.newCall(builder.build()).execute().use { response ->
                val body = response.body?.string().orEmpty()
                val payload = runCatching { JSONObject(body) }.getOrDefault(JSONObject())
                if (!response.isSuccessful) error(payload.optString("error").ifBlank { "Trial service is temporarily unavailable" })
                payload
            }
        }
    }

    private fun parseOffers(payload: JSONObject): List<NativeTrialOffer> {
        val array = payload.optJSONArray("offers") ?: JSONArray()
        return buildList {
            for (index in 0 until array.length()) {
                val raw = array.optJSONObject(index) ?: continue
                val response = raw.optJSONObject("response") ?: JSONObject()
                val targets = raw.optJSONArray("courseTargets") ?: JSONArray()
                val parsedTargets = buildList {
                    for (targetIndex in 0 until targets.length()) {
                        val item = targets.optJSONObject(targetIndex) ?: continue
                        val source = item.optString("source").trim().lowercase()
                        val courseId = item.optString("courseId").trim()
                        if (source !in setOf("cps", "our") || courseId.isBlank()) continue
                        add(NativeTrialCourseTarget(source, courseId, item.optString("title").ifBlank { "Course" }))
                    }
                }
                add(
                    NativeTrialOffer(
                        id = raw.optString("id"),
                        title = raw.optString("title").ifBlank { "Free trial" },
                        durationValue = raw.optDouble("durationValue", 0.0),
                        durationUnit = raw.optString("durationUnit"),
                        durationMs = raw.optLong("durationMs", 0L),
                        courseTargets = parsedTargets,
                        status = response.optString("status", "pending"),
                        claimedAtMs = response.optLong("claimedAtMs", 0L),
                        expiresAtMs = response.optLong("expiresAtMs", 0L),
                        cancelledAtMs = response.optLong("cancelledAtMs", 0L),
                    ),
                )
            }
        }
    }
}

data class NativeTrialUiState(
    val offers: List<NativeTrialOffer> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
    val modalDismissedForSession: Boolean = false,
) {
    val pending: List<NativeTrialOffer> get() = offers.filter { it.isPending }
    val active: List<NativeTrialOffer> get() = offers.filter { it.isActive }
}

object NativeTrialStore {
    private val _state = MutableStateFlow(NativeTrialUiState())
    val state: StateFlow<NativeTrialUiState> = _state.asStateFlow()
    @Volatile private var currentUid: String = ""

    fun loadCached(context: Context, uid: String) {
        if (uid.isBlank()) return
        currentUid = uid
        val cached = NativeTrialRepository(context).cached(uid)
        _state.value = _state.value.copy(offers = cached, error = null)
    }

    suspend fun refresh(context: Context, uid: String, online: Boolean, forceModal: Boolean = false) {
        if (uid.isBlank()) return
        if (uid != currentUid) {
            currentUid = uid
            _state.value = NativeTrialUiState(offers = NativeTrialRepository(context).cached(uid))
        }
        if (!online) return
        runCatching { NativeTrialRepository(context).mine(uid) }
            .onSuccess { offers ->
                _state.value = _state.value.copy(
                    offers = offers,
                    busy = false,
                    error = null,
                    modalDismissedForSession = if (forceModal) false else _state.value.modalDismissedForSession,
                )
            }
            .onFailure { error -> _state.value = _state.value.copy(busy = false, error = error.message) }
    }

    suspend fun claim(context: Context, uid: String, campaignId: String) {
        if (uid.isBlank() || campaignId.isBlank()) return
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { NativeTrialRepository(context).claim(uid, campaignId) }
            .onSuccess { offers -> _state.value = _state.value.copy(offers = offers, busy = false, modalDismissedForSession = false) }
            .onFailure { error -> _state.value = _state.value.copy(busy = false, error = error.message) }
    }

    suspend fun cancel(context: Context, uid: String, campaignId: String) {
        if (uid.isBlank() || campaignId.isBlank()) return
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { NativeTrialRepository(context).cancel(uid, campaignId) }
            .onSuccess { offers -> _state.value = _state.value.copy(offers = offers, busy = false, modalDismissedForSession = false) }
            .onFailure { error -> _state.value = _state.value.copy(busy = false, error = error.message) }
    }

    fun dismissModalForSession() {
        _state.value = _state.value.copy(modalDismissedForSession = true)
    }

    fun reset() {
        currentUid = ""
        _state.value = NativeTrialUiState()
    }
}
