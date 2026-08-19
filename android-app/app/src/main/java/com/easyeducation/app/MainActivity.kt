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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var googleSignInClient: GoogleSignInClient
    private lateinit var viewModel: NativeAppViewModel
    private var initialPath by mutableStateOf<String?>(null)

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
            .addOnSuccessListener {
                lifecycleScope.launch(Dispatchers.IO) { NativePushRegistrar.register(this@MainActivity) }
            }
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
        if (FirebaseAuth.getInstance().currentUser != null) {
            lifecycleScope.launch(Dispatchers.IO) { NativePushRegistrar.register(this@MainActivity) }
        }
    }

    private fun launchGoogleSignIn() {
        googleSignInClient.signOut().addOnCompleteListener {
            googleLauncher.launch(googleSignInClient.signInIntent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        initialPath = intent.getStringExtra(EXTRA_OPEN_PATH)
    }

    companion object {
        const val EXTRA_OPEN_PATH = "open_path"
        private const val NOTIFICATION_REQUEST = 10
    }
}
