package com.easyeducation.app

import android.content.Context
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/**
 * Secondary Firebase Auth session for the read-only CPS source project.
 *
 * Easy Education remains the authoritative app/auth project. This session exists only so CPS
 * Firestore READ requests can carry the same CPS Firebase ID token that the supplied working HTML
 * attaches when a Google user is signed in. Nothing here writes to CPS Firestore.
 */
object CpsFirebaseSession {
    private const val APP_NAME = "cps-read-source"
    private const val CPS_PROJECT_ID = "secure-sublime-cjkjx"
    private const val CPS_API_KEY = "AIzaSyBK3MFPCsxXCqu_hYSj5gZ7FrHhsPRxbXg"
    private const val CPS_APP_ID = "1:242449600834:web:619c526fe0fb6d55aaf8db"
    private const val CPS_SENDER_ID = "242449600834"
    private const val CPS_STORAGE_BUCKET = "secure-sublime-cjkjx.firebasestorage.app"
    private const val RETRY_DELAY_MS = 2 * 60_000L

    @Volatile
    private var retryAfterMs: Long = 0L

    private fun auth(context: Context): FirebaseAuth {
        val appContext = context.applicationContext
        val app = FirebaseApp.getApps(appContext).firstOrNull { it.name == APP_NAME }
            ?: FirebaseApp.initializeApp(
                appContext,
                FirebaseOptions.Builder()
                    .setProjectId(CPS_PROJECT_ID)
                    .setApiKey(CPS_API_KEY)
                    .setApplicationId(CPS_APP_ID)
                    .setGcmSenderId(CPS_SENDER_ID)
                    .setStorageBucket(CPS_STORAGE_BUCKET)
                    .build(),
                APP_NAME,
            )
            ?: error("CPS Firebase could not initialize")
        return FirebaseAuth.getInstance(app)
    }

    suspend fun signInWithGoogle(context: Context, googleIdToken: String): Boolean {
        if (googleIdToken.isBlank()) return false
        return runCatching {
            auth(context)
                .signInWithCredential(GoogleAuthProvider.getCredential(googleIdToken, null))
                .await()
            retryAfterMs = 0L
            true
        }.getOrElse {
            // A CPS source-session failure must never break Easy Education authentication.
            retryAfterMs = System.currentTimeMillis() + RETRY_DELAY_MS
            false
        }
    }

    suspend fun sourceIdToken(context: Context, forceRefresh: Boolean = false): String? {
        val cpsAuth = runCatching { auth(context) }.getOrNull() ?: return null
        var user = cpsAuth.currentUser
        if (user == null && System.currentTimeMillis() >= retryAfterMs) {
            val googleToken = runCatching { GoogleSignIn.getLastSignedInAccount(context)?.idToken }.getOrNull()
            if (!googleToken.isNullOrBlank()) {
                signInWithGoogle(context, googleToken)
                user = cpsAuth.currentUser
            }
        }
        return user?.let { current ->
            runCatching { current.getIdToken(forceRefresh).await().token }
                .getOrNull()
                ?.takeIf { it.isNotBlank() }
        }
    }

    fun signOut(context: Context) {
        runCatching { auth(context).signOut() }
        retryAfterMs = 0L
    }
}
