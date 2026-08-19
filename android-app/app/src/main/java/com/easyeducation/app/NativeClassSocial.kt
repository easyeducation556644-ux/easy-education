package com.easyeducation.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.util.Date

private data class NativeComment(
    val id: String,
    val userName: String,
    val text: String,
    val timestamp: Long,
)

@Composable
fun NativeClassSocial(
    classId: String,
    user: FirebaseUser?,
    modifier: Modifier = Modifier,
) {
    val db = remember { FirebaseFirestore.getInstance() }
    val scope = rememberCoroutineScope()
    var likes by remember(classId) { mutableStateOf(0) }
    var dislikes by remember(classId) { mutableStateOf(0) }
    var myReaction by remember(classId, user?.uid) { mutableStateOf<String?>(null) }
    var comments by remember(classId) { mutableStateOf<List<NativeComment>>(emptyList()) }
    var commentText by remember(classId) { mutableStateOf("") }
    var message by remember(classId) { mutableStateOf<String?>(null) }
    var sending by remember(classId) { mutableStateOf(false) }

    DisposableEffect(classId, user?.uid) {
        val reactionsListener = db.collection("classReactions")
            .whereEqualTo("classId", classId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    message = "Reactions are temporarily unavailable."
                    return@addSnapshotListener
                }
                val docs = snapshot?.documents.orEmpty()
                likes = docs.count { it.getString("type") == "like" }
                dislikes = docs.count { it.getString("type") == "dislike" }
                myReaction = user?.uid?.let { uid ->
                    docs.firstOrNull { it.getString("userId") == uid }?.getString("type")
                }
            }
        val commentsListener = db.collection("classComments")
            .whereEqualTo("classId", classId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    message = "Comments are temporarily unavailable."
                    return@addSnapshotListener
                }
                comments = snapshot?.documents.orEmpty()
                    .filter { doc ->
                        val parent = doc.getString("parentId").orEmpty()
                        doc.getBoolean("isTopLevel") == true || parent.isBlank()
                    }
                    .map { doc ->
                        NativeComment(
                            id = doc.id,
                            userName = doc.getString("userName").orEmpty().ifBlank { "Student" },
                            text = doc.getString("text").orEmpty(),
                            timestamp = socialTimestampMillis(doc.get("timestamp")),
                        )
                    }
                    .filter { it.text.isNotBlank() }
                    .sortedByDescending { it.timestamp }
                    .take(40)
            }
        onDispose {
            reactionsListener.remove()
            commentsListener.remove()
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SocialReactionButton(
                label = "Like",
                count = likes,
                selected = myReaction == "like",
                icon = { Icon(Icons.Default.ThumbUp, null, modifier = Modifier.size(19.dp)) },
                modifier = Modifier.weight(1f),
            ) {
                user ?: return@SocialReactionButton
                scope.launch {
                    updateReaction(db, classId, user, "like", myReaction == "like")
                        .onFailure { message = "Could not save reaction. Try again." }
                }
            }
            SocialReactionButton(
                label = "Dislike",
                count = dislikes,
                selected = myReaction == "dislike",
                icon = { Icon(Icons.Default.ThumbDown, null, modifier = Modifier.size(19.dp)) },
                modifier = Modifier.weight(1f),
            ) {
                user ?: return@SocialReactionButton
                scope.launch {
                    updateReaction(db, classId, user, "dislike", myReaction == "dislike")
                        .onFailure { message = "Could not save reaction. Try again." }
                }
            }
        }

        Text("Comments ${comments.size}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (user != null) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
                    Icon(Icons.Default.Person, null, Modifier.padding(9.dp).size(20.dp))
                }
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = commentText,
                    onValueChange = { commentText = it.take(700) },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Add a comment…") },
                    maxLines = 4,
                    shape = RoundedCornerShape(18.dp),
                    trailingIcon = {
                        IconButton(
                            enabled = commentText.isNotBlank() && !sending,
                            onClick = {
                                val text = commentText.trim()
                                if (text.isBlank()) return@IconButton
                                sending = true
                                scope.launch {
                                    val result = runCatching {
                                        withContext(Dispatchers.IO) {
                                            db.collection("classComments").add(
                                                mapOf(
                                                    "classId" to classId,
                                                    "classTopLevelKey" to "${classId}_toplevel",
                                                    "userId" to user.uid,
                                                    "userName" to (user.displayName ?: user.email ?: "Student"),
                                                    "userPhoto" to (user.photoUrl?.toString() ?: ""),
                                                    "text" to text,
                                                    "parentId" to "",
                                                    "isTopLevel" to true,
                                                    "timestamp" to FieldValue.serverTimestamp(),
                                                ),
                                            ).await()
                                        }
                                    }
                                    sending = false
                                    result.onSuccess { commentText = "" }
                                        .onFailure { message = "Could not post comment. Try again." }
                                }
                            },
                        ) { Icon(Icons.Default.Send, "Post comment") }
                    },
                )
            }
        }

        message?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        comments.take(8).forEach { comment ->
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shape = RoundedCornerShape(16.dp),
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface) {
                        Icon(Icons.Default.Person, null, Modifier.padding(7.dp).size(17.dp))
                    }
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f)) {
                        Text(comment.userName, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                        Text(comment.text, maxLines = 6, overflow = TextOverflow.Ellipsis)
                        if (comment.timestamp > 0L) {
                            Text(socialRelativeTime(comment.timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (comments.size > 8) {
            Text("Showing latest 8 comments", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SocialReactionButton(
    label: String,
    count: Int,
    selected: Boolean,
    icon: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    if (selected) {
        androidx.compose.material3.Button(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(999.dp)) {
            icon(); Spacer(Modifier.width(7.dp)); Text("$label  $count")
        }
    } else {
        OutlinedButton(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(999.dp)) {
            icon(); Spacer(Modifier.width(7.dp)); Text("$label  $count")
        }
    }
}

private suspend fun updateReaction(
    db: FirebaseFirestore,
    classId: String,
    user: FirebaseUser,
    type: String,
    remove: Boolean,
): Result<Unit> = runCatching {
    withContext(Dispatchers.IO) {
        val ref = db.collection("classReactions").document("${user.uid}_$classId")
        if (remove) {
            ref.delete().await()
        } else {
            ref.set(
                mapOf(
                    "userId" to user.uid,
                    "userName" to (user.displayName ?: user.email ?: "Student"),
                    "userPhoto" to (user.photoUrl?.toString() ?: ""),
                    "classId" to classId,
                    "type" to type,
                    "timestamp" to FieldValue.serverTimestamp(),
                ),
            ).await()
        }
    }
}

private fun socialTimestampMillis(value: Any?): Long = when (value) {
    is Timestamp -> value.toDate().time
    is Date -> value.time
    is Number -> value.toLong()
    else -> 0L
}

private fun socialRelativeTime(time: Long): String {
    val delta = (System.currentTimeMillis() - time).coerceAtLeast(0L)
    return when {
        delta < 60_000L -> "just now"
        delta < 3_600_000L -> "${delta / 60_000L}m ago"
        delta < 86_400_000L -> "${delta / 3_600_000L}h ago"
        else -> "${delta / 86_400_000L}d ago"
    }
}
