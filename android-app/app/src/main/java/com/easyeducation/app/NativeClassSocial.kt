@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
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
    val userPhoto: String,
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
    var commentsOpen by remember(classId) { mutableStateOf(false) }

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
                            userPhoto = doc.getString("userPhoto").orEmpty(),
                            text = doc.getString("text").orEmpty(),
                            timestamp = socialTimestampMillis(doc.get("timestamp")),
                        )
                    }
                    .filter { it.text.isNotBlank() }
                    .sortedByDescending { it.timestamp }
                    .take(80)
            }
        onDispose {
            reactionsListener.remove()
            commentsListener.remove()
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier
                        .weight(1f)
                        .clickable(enabled = user != null) {
                            user ?: return@clickable
                            scope.launch {
                                updateReaction(db, classId, user, "like", myReaction == "like")
                                    .onFailure { message = "Could not save reaction. Try again." }
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ThumbUp,
                        contentDescription = "Like",
                        modifier = Modifier.size(20.dp),
                        tint = if (myReaction == "like") MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(likes.toString(), fontWeight = FontWeight.SemiBold)
                }
                Box(
                    Modifier
                        .width(1.dp)
                        .height(26.dp)
                        .background(MaterialTheme.colorScheme.outlineVariant),
                )
                Row(
                    Modifier
                        .weight(1f)
                        .clickable(enabled = user != null) {
                            user ?: return@clickable
                            scope.launch {
                                updateReaction(db, classId, user, "dislike", myReaction == "dislike")
                                    .onFailure { message = "Could not save reaction. Try again." }
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ThumbDown,
                        contentDescription = "Dislike",
                        modifier = Modifier.size(20.dp),
                        tint = if (myReaction == "dislike") MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface,
                    )
                    if (dislikes > 0) {
                        Spacer(Modifier.width(7.dp))
                        Text(dislikes.toString(), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { commentsOpen = true },
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Comments", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(7.dp))
                    Text(comments.size.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val preview = comments.firstOrNull()
                if (preview == null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Add the first comment",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.Top) {
                        CommentAvatar(preview.userPhoto, Modifier.size(30.dp))
                        Spacer(Modifier.width(9.dp))
                        Text(
                            preview.text,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        message?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (commentsOpen) {
        ModalBottomSheet(onDismissRequest = { commentsOpen = false }) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.82f)) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Comments", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    Text(comments.size.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                if (user != null) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CommentAvatar(user.photoUrl?.toString().orEmpty(), Modifier.size(36.dp))
                        Spacer(Modifier.width(9.dp))
                        OutlinedTextField(
                            value = commentText,
                            onValueChange = { commentText = it.take(700) },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Add a comment…") },
                            maxLines = 4,
                            shape = RoundedCornerShape(22.dp),
                            trailingIcon = {
                                if (sending) {
                                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                } else {
                                    IconButton(
                                        enabled = commentText.isNotBlank(),
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
                                }
                            },
                        )
                    }
                }

                LazyColumn(
                    Modifier.fillMaxWidth().weight(1f),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    if (comments.isEmpty()) {
                        item {
                            Text(
                                "No comments yet.",
                                modifier = Modifier.padding(vertical = 18.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        items(comments, key = { it.id }) { comment ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                                CommentAvatar(comment.userPhoto, Modifier.size(36.dp))
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            comment.userName,
                                            fontWeight = FontWeight.SemiBold,
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                        if (comment.timestamp > 0L) {
                                            Spacer(Modifier.width(7.dp))
                                            Text(
                                                socialRelativeTime(comment.timestamp),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    Spacer(Modifier.height(3.dp))
                                    Text(comment.text)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CommentAvatar(url: String, modifier: Modifier) {
    if (url.isNotBlank()) {
        AsyncImage(
            model = url,
            contentDescription = null,
            modifier = modifier.clip(CircleShape),
        )
    } else {
        Surface(modifier = modifier, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Person, null, Modifier.size(19.dp))
            }
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
