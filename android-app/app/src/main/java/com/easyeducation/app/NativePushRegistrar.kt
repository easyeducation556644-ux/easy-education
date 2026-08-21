package com.easyeducation.app

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

object NativePushRegistrar {
    private const val APP_ORIGIN = "https://easy-education.vercel.app"
    private const val PREFS = "native_push_registration_v3"
    private const val DEVICE_ID = "device_id"
    private const val SIGNATURE = "signature"

    fun register(context: Context) {
        val user = FirebaseAuth.getInstance().currentUser ?: return
        runCatching {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val deviceId = prefs.getString(DEVICE_ID, null)?.takeIf { it.isNotBlank() }
                ?: UUID.randomUUID().toString().also { prefs.edit().putString(DEVICE_ID, it).apply() }
            val pushToken = Tasks.await(FirebaseMessaging.getInstance().token)
            if (pushToken.isNullOrBlank()) return
            val signature = "${user.uid}:$deviceId:$pushToken"
            if (prefs.getString(SIGNATURE, null) == signature) return
            val idToken = Tasks.await(user.getIdToken(false)).token ?: return
            val body = JSONObject()
                .put("action", "register")
                .put("token", pushToken)
                .put("deviceId", deviceId)
                .put("platform", "android")
                .put("notificationsAllowed", true)
                .toString()
            val http = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .build()
            http.newCall(
                Request.Builder()
                    .url("$APP_ORIGIN/api/learning-push")
                    .header("Authorization", "Bearer $idToken")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build(),
            ).execute().use { response ->
                if (!response.isSuccessful) error("Push registration HTTP ${response.code}")
                val payload = JSONObject(response.body?.string().orEmpty())
                if (!payload.optBoolean("success")) error(payload.optString("error", "Push registration failed"))
                prefs.edit().putString(SIGNATURE, signature).apply()
            }
        }
    }
}
