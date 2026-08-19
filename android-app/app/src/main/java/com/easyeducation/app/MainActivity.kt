package com.easyeducation.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.ViewModelProvider
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider

class MainActivity : ComponentActivity() {
    private lateinit var googleSignInClient: GoogleSignInClient
    private lateinit var viewModel: NativeAppViewModel
    private var initialPath: String? = null

    private val googleLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val account = runCatching {
            GoogleSignIn.getSignedInAccountFromIntent(result.data).getResult(ApiException::class.java)
        }.getOrElse {
            Toast.makeText(this, it.message ?: "Google sign-in failed", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }
        val idToken = account.idToken
        if (idToken.isNullOrBlank()) {
            Toast.makeText(this, "Google ID token was not returned", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }
        FirebaseAuth.getInstance()
            .signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))
            .addOnFailureListener { error ->
                Toast.makeText(this, error.message ?: "Firebase sign-in failed", Toast.LENGTH_LONG).show()
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

        setContent {
            EasyEducationNativeApp(
                viewModel = viewModel,
                onGoogleSignIn = ::launchGoogleSignIn,
                initialPath = initialPath,
            )
        }
        SecureDownloadService.resumePending(this)
    }

    private fun launchGoogleSignIn() {
        googleSignInClient.signOut().addOnCompleteListener {
            googleLauncher.launch(googleSignInClient.signInIntent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getStringExtra(EXTRA_OPEN_PATH) == "/downloads") {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(EXTRA_OPEN_PATH, "/downloads")
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
    }

    companion object {
        const val EXTRA_OPEN_PATH = "open_path"
        private const val NOTIFICATION_REQUEST = 10
    }
}
