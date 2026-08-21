package com.easyeducation.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun EasyEducationSecureRoot(
    viewModel: NativeAppViewModel,
    onGoogleSignIn: () -> Unit,
    loginBusy: Boolean = false,
    activeDevices: List<NativeActiveDevice> = emptyList(),
    initialPath: String? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val restriction = state.restrictionMessage

    if (state.authReady && state.user != null && restriction != null) {
        EasyEducationTheme {
            Surface(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(24.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(Icons.Default.Lock, contentDescription = null)
                            Text("Account restricted", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            Text(restriction)
                            Spacer(Modifier.height(4.dp))
                            Button(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
                        }
                    }
                }
            }
        }
    } else {
        EasyEducationNativeAppV2(
            viewModel = viewModel,
            onGoogleSignIn = onGoogleSignIn,
            loginBusy = loginBusy,
            activeDevices = activeDevices,
            initialPath = initialPath,
        )
    }
}
