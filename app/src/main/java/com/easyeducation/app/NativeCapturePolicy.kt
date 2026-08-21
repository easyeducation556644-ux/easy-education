package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.view.WindowManager
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * Screen capture is denied by default. The last verified policy is applied instantly, then a
 * foreground/server refresh propagates admin changes without waiting for the old 24-hour TTL.
 * Cached policy remains only as an offline/startup fallback.
 */
object NativeCapturePolicy {
    private const val PREFS = "native_capture_policy_v2"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun applyCached(activity: Activity, user: FirebaseUser?) {
        apply(activity, user?.uid)
    }

    fun refreshNow(activity: Activity, user: FirebaseUser?) {
        applyCached(activity, user)
        val uid = user?.uid?.takeIf { it.isNotBlank() } ?: return
        scope.launch {
            val snapshot = runCatching {
                FirebaseFirestore.getInstance().collection("users").document(uid).get(Source.SERVER).await()
            }.getOrNull() ?: return@launch
            if (!snapshot.exists()) return@launch

            val allowed = snapshot.getBoolean("allowScreenCapture") == true
            activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("allow:$uid", allowed)
                .putLong("checked:$uid", System.currentTimeMillis())
                .apply()

            withContext(Dispatchers.Main.immediate) {
                if (!activity.isFinishing && !activity.isDestroyed) apply(activity, uid)
            }
        }
    }

    /** Backward-compatible call site; it now refreshes immediately instead of waiting a day. */
    fun refreshIfDue(activity: Activity, user: FirebaseUser?) = refreshNow(activity, user)

    fun clearUser(activity: Activity, uid: String?) {
        if (!uid.isNullOrBlank()) {
            activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove("allow:$uid").remove("checked:$uid").apply()
        }
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun apply(activity: Activity, uid: String?) {
        val allow = if (uid.isNullOrBlank()) false else {
            activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean("allow:$uid", false)
        }
        if (allow) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
