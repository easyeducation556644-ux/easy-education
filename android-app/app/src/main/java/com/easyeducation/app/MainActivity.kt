package com.easyeducation.app

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var googleSignInClient: GoogleSignInClient
    private lateinit var viewModel: NativeAppViewModel
    private var initialPath by mutableStateOf<String?>(null)
    private var navigationEpoch by mutableIntStateOf(0)
    private var loginBusy by mutableStateOf(false)
    private var activeDevices by mutableStateOf<List<NativeActiveDevice>>(emptyList())
    private var deviceListener: ListenerRegistration? = null

    private val authStateListener = FirebaseAuth.AuthStateListener { auth ->
        observeDeviceSession(auth.currentUser)
    }

    private val googleLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val account = runCatching {
            GoogleSignIn.getSignedInAccountFromIntent(result.data).getResult(ApiException::class.java)
        }.getOrElse { error ->
            loginBusy = false
            if ((error as? ApiException)?.statusCode != 12501) {
                Toast.makeText(this, error.message ?: "Google sign-in failed", Toast.LENGTH_LONG).show()
            }
            return@registerForActivityResult
        }
        val idToken = account.idToken
        if (idToken.isNullOrBlank()) {
            loginBusy = false
            Toast.makeText(this, "Google ID token was not returned", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }
        FirebaseAuth.getInstance()
            .signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))
            .addOnSuccessListener { result ->
                loginBusy = false
                Toast.makeText(this, "Login successful", Toast.LENGTH_SHORT).show()
                lifecycleScope.launch(Dispatchers.IO) {
                    // Mirror the supplied CPS HTML auth flow with an isolated secondary Firebase
                    // session. Failure here never blocks the Easy Education account.
                    runCatching { CpsFirebaseSession.signInWithGoogle(this@MainActivity, idToken) }
                    runCatching { NativeDeviceSession.registerFreshLogin(this@MainActivity, result.user!!) }
                    runCatching { NativePushRegistrar.register(this@MainActivity) }
                    withContext(Dispatchers.Main) {
                        observeDeviceSession(FirebaseAuth.getInstance().currentUser)
                        viewModel.refreshOnline()
                    }
                }
            }
            .addOnFailureListener { error ->
                loginBusy = false
                Toast.makeText(this, error.message ?: "Firebase sign-in failed", Toast.LENGTH_LONG).show()
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        runCatching { LegacyDownloadCleanup.runOnce(this) }
        runCatching { SecureHlsDownloadService.cleanupPlaintext(this) }
        runCatching { SecureYoutubeDownloadService.cleanupPlaintext(this) }

        initialPath = intent?.getStringExtra(EXTRA_OPEN_PATH)
        viewModel = ViewModelProvider(this)[NativeAppViewModel::class.java]

        val googleOptions = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(getString(R.string.default_web_client_id))
            .requestEmail()
            .build()
        googleSignInClient = GoogleSignIn.getClient(this, googleOptions)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_REQUEST)
        }

        FirebaseAuth.getInstance().addAuthStateListener(authStateListener)

        setContent {
            key(initialPath, navigationEpoch) {
                EasyEducationSecureRoot(
                    viewModel = viewModel,
                    onGoogleSignIn = ::launchGoogleSignIn,
                    loginBusy = loginBusy,
                    activeDevices = activeDevices,
                    initialPath = initialPath,
                )
            }
        }

        runCatching { SecureDownloadCoordinator.resumePending(this) }
        if (FirebaseAuth.getInstance().currentUser != null) {
            lifecycleScope.launch(Dispatchers.IO) {
                FirebaseAuth.getInstance().currentUser?.let { user ->
                    runCatching { NativeDeviceSession.ensureCurrentDevice(this@MainActivity, user) }
                }
                runCatching { NativePushRegistrar.register(this@MainActivity) }
                // Existing sessions can reuse the last Google credential to establish CPS auth.
                runCatching { CpsFirebaseSession.sourceIdToken(this@MainActivity, forceRefresh = false) }
            }
        }
    }

    private fun launchGoogleSignIn() {
        if (loginBusy) return
        loginBusy = true
        googleSignInClient.signOut().addOnCompleteListener {
            googleLauncher.launch(googleSignInClient.signInIntent)
        }
    }

    private fun observeDeviceSession(user: FirebaseUser?) {
        deviceListener?.remove()
        deviceListener = null
        if (user == null) {
            activeDevices = emptyList()
            CpsFirebaseSession.signOut(this)
            NativeFullscreenOverlay.dismiss(immediate = true)
            NativeMiniPlayerOverlay.dismiss(releasePlayer = true)
            NativePlayerMediaSession.release()
            PersistentNativePlayer.resetForSignOut(this)
            return
        }
        deviceListener = NativeDeviceSession.observe(
            context = this,
            user = user,
            onDevices = { devices -> activeDevices = devices },
            onForcedOut = { message ->
                activeDevices = emptyList()
                CpsFirebaseSession.signOut(this)
                NativeFullscreenOverlay.dismiss(immediate = true)
                NativeMiniPlayerOverlay.dismiss(releasePlayer = true)
                NativePlayerMediaSession.release()
                PersistentNativePlayer.resetForSignOut(this)
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            },
        )
    }

    /**
     * YouTube-style app-background behavior: hand the already prepared player surface to Android's
     * native Picture-in-Picture window. No resolver, MediaSource replacement or prepare() occurs.
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        maybeEnterNativePip()
    }

    private fun maybeEnterNativePip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || isInPictureInPictureMode) return
        if (FirebaseAuth.getInstance().currentUser == null) return
        if (PersistentNativePlayer.currentClassId().isBlank()) return

        val exo = PersistentNativePlayer.player(this)
        // A stale/paused session must never pull the whole app into PiP. Only an actively playing
        // video is eligible for the controlled handoff.
        if (exo.mediaItemCount == 0 || !exo.isPlaying) return

        if (NativeFullscreenOverlay.owns(exo)) NativeFullscreenOverlay.dismiss(immediate = true)
        if (!NativeMiniPlayerOverlay.ensureForPip(this)) return
        NativePlayerMediaSession.ensure(this)

        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
        NativeMiniPlayerOverlay.pipSourceRect(this)?.let(builder::setSourceRectHint)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setSeamlessResizeEnabled(true)
            // Entry is manual because the shared video surface must be staged first. Explicitly
            // disable Android's whole-activity auto-entry path.
            builder.setAutoEnterEnabled(false)
        }
        val entered = runCatching { enterPictureInPictureMode(builder.build()) }.getOrDefault(false)
        if (!entered) {
            NativeMiniPlayerOverlay.abortPipAndPause(this)
            NativePlayerMediaSession.release()
        }
    }

    override fun onStop() {
        if (!isChangingConfigurations && !isInPictureInPictureMode) {
            // This is the hard safety net for Home/recents gestures and failed PiP entry. No video
            // may keep producing audio behind an invisible activity.
            NativeMiniPlayerOverlay.abortPipAndPause(this)
            PersistentNativePlayer.savePosition(this)
            PersistentNativePlayer.pause()
        }
        super.onStop()
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (!isInPictureInPictureMode) {
            if (isFinishing || isDestroyed) {
                NativeMiniPlayerOverlay.dismiss(releasePlayer = true)
                NativePlayerMediaSession.release()
                return
            }
            val classId = PersistentNativePlayer.currentClassId()
            if (classId.isNotBlank() && NativeInlineSurfaceRegistry.canRestore()) {
                val exo = PersistentNativePlayer.player(this)
                NativeMiniPlayerOverlay.dismiss(releasePlayer = false)
                if (!NativeInlineSurfaceRegistry.restore(exo)) {
                    NativeMiniPlayerOverlay.show(
                        activity = this,
                        exoPlayer = exo,
                        classId = classId,
                        sourceUrl = PersistentNativePlayer.currentSourceUrl(),
                        title = "",
                        requestedHeight = PersistentNativePlayer.currentHeight().takeIf { it > 0 } ?: 480,
                    )
                }
            } else {
                NativeMiniPlayerOverlay.exitPipPresentation()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        initialPath = intent.getStringExtra(EXTRA_OPEN_PATH)
        navigationEpoch += 1
    }

    override fun onDestroy() {
        deviceListener?.remove()
        FirebaseAuth.getInstance().removeAuthStateListener(authStateListener)
        NativeFullscreenOverlay.dismiss(immediate = true)
        if (isFinishing) NativePlayerMediaSession.release()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_OPEN_PATH = "open_path"
        private const val NOTIFICATION_REQUEST = 10
    }
}
