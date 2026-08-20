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
 * Screen capture is denied by default. A Full Admin / permitted moderator can explicitly opt a
 * user out of FLAG_SECURE from the website Users panel. The result is cached per UID for 24 hours
 * so normal app launches do not create a Firestore read every time.
 */
object NativeCapturePolicy {
    private const val PREFS = "native_capture_policy_v1"
    private const val CACHE_TTL_MS = 24L * 60L * 60L * 1000L
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun applyCached(activity: Activity, user: FirebaseUser?) {
        apply(activity, user?.uid)
    }

    fun refreshIfDue(activity: Activity, user: FirebaseUser?) {
        applyCached(activity, user)
        val uid = user?.uid?.takeIf { it.isNotBlank() } ?: return
        val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lastChecked = prefs.getLong("checked:$uid", 0L)
        val now = System.currentTimeMillis()
        if (lastChecked > 0L && now - lastChecked < CACHE_TTL_MS) return

        scope.launch {
            val snapshot = runCatching {
                FirebaseFirestore.getInstance().collection("users").document(uid).get(Source.SERVER).await()
            }.getOrNull() ?: return@launch
            if (!snapshot.exists()) return@launch

            val allowed = snapshot.getBoolean("allowScreenCapture") == true
            prefs.edit()
                .putBoolean("allow:$uid", allowed)
                .putLong("checked:$uid", System.currentTimeMillis())
                .apply()

            withContext(Dispatchers.Main.immediate) {
                if (!activity.isFinishing && !activity.isDestroyed) apply(activity, uid)
            }
        }
    }

    private fun apply(activity: Activity, uid: String?) {
        val allow = if (uid.isNullOrBlank()) false else {
            activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean("allow:$uid", false)
        }
        if (allow) {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
