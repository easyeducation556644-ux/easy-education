package com.easyeducation.app

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source
import com.google.firebase.Timestamp
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.util.Locale
import java.util.UUID

object NativeDeviceSession {
    private const val PREFS = "native_device_session_v1"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_LOGIN_AT = "login_at"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun deviceId(context: Context): String {
        val preferences = prefs(context)
        preferences.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }?.let { return it }
        val androidId = runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        }.getOrNull().orEmpty()
        val id = if (androidId.isNotBlank()) "app_${androidId}" else "app_${UUID.randomUUID()}"
        preferences.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    private fun deviceInfo(context: Context): Map<String, Any> {
        val id = deviceId(context)
        val metrics = context.resources.displayMetrics
        val now = Instant.now().toString()
        val model = listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { "Android device" }
        return mapOf(
            "id" to id,
            "fingerprint" to id,
            "ipAddress" to "app",
            "platform" to "Android",
            "deviceName" to model,
            "userAgent" to "EasyEducationAndroid/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; $model)",
            "screenResolution" to "${metrics.widthPixels}x${metrics.heightPixels}",
            "language" to Locale.getDefault().toLanguageTag(),
            "timestamp" to now,
            "lastSeen" to now,
        )
    }

    suspend fun registerFreshLogin(context: Context, user: FirebaseUser) {
        val firestore = FirebaseFirestore.getInstance()
        val ref = firestore.collection("users").document(user.uid)
        val snapshot = runCatching { ref.get(Source.SERVER).await() }.getOrNull()
        val role = snapshot?.getString("role").orEmpty()
        val current = deviceInfo(context)
        val nextDevices = if (role == "admin") {
            val previous = (snapshot?.get("devices") as? List<*>)
                .orEmpty()
                .mapNotNull { it as? Map<*, *> }
                .filterNot { entry ->
                    entry["id"]?.toString() == current["id"] ||
                        entry["fingerprint"]?.toString() == current["fingerprint"]
                }
                .map { entry -> entry.entries.associate { it.key.toString() to (it.value ?: "") } }
            previous + listOf(current)
        } else {
            listOf(current)
        }

        ref.set(
            mapOf(
                "name" to (user.displayName ?: ""),
                "email" to (user.email ?: ""),
                "photoURL" to (user.photoUrl?.toString() ?: ""),
                "devices" to nextDevices,
                "online" to true,
                "lastActive" to FieldValue.serverTimestamp(),
            ),
            SetOptions.merge(),
        ).await()
        prefs(context).edit().putLong(KEY_LOGIN_AT, System.currentTimeMillis()).apply()
    }

    fun observe(
        context: Context,
        user: FirebaseUser,
        onDeviceCount: (Int) -> Unit,
        onForcedOut: (String) -> Unit,
    ): ListenerRegistration {
        val id = deviceId(context)
        return FirebaseFirestore.getInstance()
            .collection("users")
            .document(user.uid)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener

                val role = snapshot.getString("role").orEmpty()
                val devices = (snapshot.get("devices") as? List<*>).orEmpty()
                onDeviceCount(devices.size)

                val loginAt = prefs(context).getLong(KEY_LOGIN_AT, 0L)
                val forceLogoutAt = timestampMillis(snapshot.get("forceLogoutAt"))
                if (loginAt > 0L && forceLogoutAt > loginAt + 1_000L) {
                    forceOut(onForcedOut, "You were signed out by account security.")
                    return@addSnapshotListener
                }

                if (role == "admin" || devices.isEmpty()) return@addSnapshotListener
                val exists = devices.any { raw ->
                    val map = raw as? Map<*, *> ?: return@any false
                    map["id"]?.toString() == id || map["fingerprint"]?.toString() == id
                }
                if (!exists) {
                    forceOut(onForcedOut, "This account was signed in on another device.")
                }
            }
    }

    fun clearLoginMarker(context: Context) {
        prefs(context).edit().remove(KEY_LOGIN_AT).apply()
    }

    private fun forceOut(onForcedOut: (String) -> Unit, message: String) {
        FirebaseAuth.getInstance().signOut()
        onForcedOut(message)
    }

    private fun timestampMillis(value: Any?): Long = when (value) {
        is Timestamp -> value.toDate().time
        is Number -> value.toLong()
        is String -> value.toLongOrNull() ?: 0L
        else -> 0L
    }
}
