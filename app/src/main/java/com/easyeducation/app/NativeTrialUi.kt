package com.easyeducation.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

private val TrialCardShape = RoundedCornerShape(30.dp)
private val TrialPill = RoundedCornerShape(999.dp)

@Composable
fun NativeTrialOverlayHost(
    viewModel: NativeAppViewModel,
    state: NativeUiState,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val trialState by NativeTrialStore.state.collectAsStateWithLifecycle()
    val uid = state.user?.uid.orEmpty()
    val scope = rememberCoroutineScope()

    LaunchedEffect(uid) {
        if (uid.isNotBlank()) NativeTrialStore.loadCached(context, uid) else NativeTrialStore.reset()
    }
    LaunchedEffect(uid, state.online) {
        if (uid.isNotBlank()) NativeTrialStore.refresh(context, uid, state.online)
    }

    val offer = trialState.pending.firstOrNull()
    if (offer != null && !trialState.modalDismissedForSession) {
        Dialog(
            onDismissRequest = NativeTrialStore::dismissModalForSession,
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = TrialCardShape,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column {
                        Box(
                            Modifier.fillMaxWidth().background(
                                Brush.linearGradient(
                                    listOf(
                                        MaterialTheme.colorScheme.primaryContainer,
                                        MaterialTheme.colorScheme.secondaryContainer,
                                        MaterialTheme.colorScheme.tertiaryContainer,
                                    ),
                                ),
                            ).padding(22.dp),
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)) {
                                    Icon(Icons.Default.CardGiftcard, null, Modifier.padding(12.dp).size(30.dp), tint = MaterialTheme.colorScheme.primary)
                                }
                                Text("Your free trial is ready", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                                Text(
                                    "The timer starts only after you claim it.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                )
                            }
                        }
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(shape = TrialPill, color = MaterialTheme.colorScheme.primaryContainer) {
                                    Row(Modifier.padding(horizontal = 11.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Schedule, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(5.dp))
                                        Text(trialDurationLabel(offer), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                                    }
                                }
                            }
                            Text(offer.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                offer.courseTargets.take(5).forEach { course ->
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("•", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.ExtraBold)
                                        Spacer(Modifier.width(7.dp))
                                        Text(course.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        if (course.source == "cps") {
                                            Spacer(Modifier.width(6.dp))
                                            Surface(shape = TrialPill, color = MaterialTheme.colorScheme.secondaryContainer) {
                                                Text("CPS", Modifier.padding(horizontal = 7.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                                if (offer.courseTargets.size > 5) {
                                    Text("+${offer.courseTargets.size - 5} more courses", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Button(
                                onClick = {
                                    scope.launch {
                                        NativeTrialStore.claim(context, uid, offer.id)
                                        viewModel.refreshOnline()
                                    }
                                },
                                enabled = state.online && !trialState.busy,
                                modifier = Modifier.fillMaxWidth(),
                                shape = TrialPill,
                            ) {
                                if (trialState.busy) {
                                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(8.dp))
                                }
                                Text(if (trialState.busy) "Claiming…" else "Claim Trial")
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                TextButton(onClick = NativeTrialStore::dismissModalForSession) { Text("Maybe later") }
                                TextButton(
                                    onClick = {
                                        scope.launch {
                                            NativeTrialStore.cancel(context, uid, offer.id)
                                            viewModel.refreshOnline()
                                        }
                                    },
                                    enabled = state.online && !trialState.busy,
                                ) {
                                    Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Cancel trial")
                                }
                            }
                            trialState.error?.takeIf { it.isNotBlank() }?.let { error ->
                                Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun NativeTrialHomeBanner() {
    val trialState by NativeTrialStore.state.collectAsStateWithLifecycle()
    val offer = trialState.pending.firstOrNull() ?: return
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.10f)) {
                Icon(Icons.Default.CardGiftcard, null, Modifier.padding(10.dp).size(23.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text("${trialDurationLabel(offer)} trial waiting", fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onTertiaryContainer)
                Text(
                    offer.courseTargets.take(2).joinToString(" + ") { it.title } + if (offer.courseTargets.size > 2) " + more" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.76f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TextButton(onClick = { NativeTrialStore.dismissModalForSession() }) { Text("View") }
        }
    }
}

private fun trialDurationLabel(offer: NativeTrialOffer): String {
    val amount = if (offer.durationValue % 1.0 == 0.0) offer.durationValue.toLong().toString() else offer.durationValue.toString()
    val unit = offer.durationUnit.ifBlank { "days" }.removeSuffix("s")
    return "$amount $unit${if (amount == "1") "" else "s"}"
}
