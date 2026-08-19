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
    private var loginBusy by mutableStateOf(false)
    private var activeDeviceCount by mutableStateOf(0)
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
            key(initialPath) {
                EasyEducationSecureRoot(
                    viewModel = viewModel,
                    onGoogleSignIn = ::launchGoogleSignIn,
                    loginBusy = loginBusy,
                    activeDeviceCount = activeDeviceCount,
                    initialPath = initialPath,
                )
            }
        }

        runCatching { SecureDownloadCoordinator.resumePending(this) }
        if (FirebaseAuth.getInstance().currentUser != null) {
            lifecycleScope.launch(Dispatchers.IO) {
                runCatching { NativePushRegistrar.register(this@MainActivity) }
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
            activeDeviceCount = 0
            NativeFullscreenOverlay.dismiss(immediate = true)
            NativeMiniPlayerOverlay.dismiss(releasePlayer = true)
            NativePlayerMediaSession.release()
            PersistentNativePlayer.resetForSignOut(this)
            return
        }
        deviceListener = NativeDeviceSession.observe(
            context = this,
            user = user,
            onDeviceCount = { count -> activeDeviceCount = count },
            onForcedOut = { message ->
                activeDeviceCount = 0
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
        if (exo.mediaItemCount == 0) return

        // If the user presses Home from fullscreen, first remove only that presentation. The player
        // remains prepared, then the same session is stretched into the native PiP source surface.
        if (NativeFullscreenOverlay.owns(exo)) NativeFullscreenOverlay.dismiss(immediate = true)
        if (!NativeMiniPlayerOverlay.ensureForPip(this)) return
        NativePlayerMediaSession.ensure(this)

        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setSeamlessResizeEnabled(true)
        }
        runCatching { enterPictureInPictureMode(builder.build()) }
            .onFailure { NativeMiniPlayerOverlay.exitPipPresentation() }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (!isInPictureInPictureMode) {
            NativeMiniPlayerOverlay.exitPipPresentation()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        initialPath = intent.getStringExtra(EXTRA_OPEN_PATH)
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
