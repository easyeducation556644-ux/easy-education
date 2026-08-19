@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Reply
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.layout.ContentScale
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

internal data class YoutubeClassComment(
    val id: String,
    val userId: String,
    val userName: String,
    val userPhoto: String,
    val text: String,
    val parentId: String,
    val isTopLevel: Boolean,
    val replyToUserId: String,
    val replyToUserName: String,
    val timestamp: Long,
    val editedAt: Long,
)

@Composable
fun YoutubeCommentsBlock(
    classId: String,
    courseId: String,
    classTitle: String,
    user: FirebaseUser?,
    modifier: Modifier = Modifier,
) {
    val db = remember { FirebaseFirestore.getInstance() }
    var comments by remember(classId) { mutableStateOf<List<YoutubeClassComment>>(emptyList()) }
    var loading by remember(classId) { mutableStateOf(true) }
    var sheetOpen by remember(classId) { mutableStateOf(false) }
    var error by remember(classId) { mutableStateOf<String?>(null) }

    DisposableEffect(classId) {
        val listener = db.collection("classComments")
            .whereEqualTo("classId", classId)
            .addSnapshotListener { snapshot, throwable ->
                if (throwable != null) {
                    loading = false
                    error = "Comments are temporarily unavailable."
                    return@addSnapshotListener
                }
                comments = snapshot?.documents.orEmpty().mapNotNull { doc ->
                    val text = doc.getString("text").orEmpty().trim()
                    if (text.isBlank()) return@mapNotNull null
                    YoutubeClassComment(
                        id = doc.id,
                        userId = doc.getString("userId").orEmpty(),
                        userName = doc.getString("userName").orEmpty().ifBlank { "Student" },
                        userPhoto = doc.getString("userPhoto").orEmpty(),
                        text = text,
                        parentId = doc.getString("parentId").orEmpty(),
                        isTopLevel = doc.getBoolean("isTopLevel") == true || doc.getString("parentId").isNullOrBlank(),
                        replyToUserId = doc.getString("replyToUserId").orEmpty(),
                        replyToUserName = doc.getString("replyToUserName").orEmpty(),
                        timestamp = commentMillis(doc.get("timestamp")),
                        editedAt = commentMillis(doc.get("editedAt")),
                    )
                }
                loading = false
                error = null
            }
        onDispose { listener.remove() }
    }

    val topLevel = remember(comments) {
        comments.filter { it.parentId.isBlank() || it.isTopLevel }
            .sortedWith(compareByDescending<YoutubeClassComment> { it.timestamp }.thenByDescending { it.id })
    }
    val preview = topLevel.firstOrNull()

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(18.dp))
            .clickable { sheetOpen = true },
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Comments", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.width(6.dp))
                Text(topLevel.size.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                Text("●", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(4.dp))
                Text("●", color = MaterialTheme.colorScheme.outlineVariant)
            }
            Spacer(Modifier.size(9.dp))
            when {
                loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(9.dp))
                    Text("Loading comments…", style = MaterialTheme.typography.bodySmall)
                }
                preview != null -> Row(verticalAlignment = Alignment.Top) {
                    CommentAvatar(preview.userPhoto, Modifier.size(32.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("@${preview.userName}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                        Text(preview.displayText(), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
                else -> Text(
                    error ?: "No comments yet. Add the first comment.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (sheetOpen) {
        YoutubeCommentsSheet(
            comments = comments,
            loading = loading,
            error = error,
            user = user,
            classId = classId,
            courseId = courseId,
            classTitle = classTitle,
            db = db,
            onDismiss = { sheetOpen = false },
            onMessage = { error = it },
        )
    }
}

@Composable
private fun YoutubeCommentsSheet(
    comments: List<YoutubeClassComment>,
    loading: Boolean,
    error: String?,
    user: FirebaseUser?,
    classId: String,
    courseId: String,
    classTitle: String,
    db: FirebaseFirestore,
    onDismiss: () -> Unit,
    onMessage: (String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var draft by remember(classId) { mutableStateOf("") }
    var replyTarget by remember(classId) { mutableStateOf<YoutubeClassComment?>(null) }
    var editTarget by remember(classId) { mutableStateOf<YoutubeClassComment?>(null) }
    var sending by remember(classId) { mutableStateOf(false) }

    val topLevel = remember(comments) {
        comments.filter { it.parentId.isBlank() || it.isTopLevel }
            .sortedWith(compareByDescending<YoutubeClassComment> { it.timestamp }.thenByDescending { it.id })
    }
    val repliesByParent = remember(comments) {
        comments.filter { it.parentId.isNotBlank() }
            .groupBy { it.parentId }
            .mapValues { (_, values) -> values.sortedBy { it.timestamp } }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.92f)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 2.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Comments ${topLevel.size}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Close comments") }
            }
            HorizontalDivider()

            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    topLevel.isEmpty() -> Text(
                        error ?: "No comments yet. Be the first to comment.",
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    else -> LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(topLevel, key = { it.id }) { comment ->
                            YoutubeCommentThread(
                                comment = comment,
                                repliesByParent = repliesByParent,
                                currentUser = user,
                                depth = 0,
                                onReply = { target ->
                                    editTarget = null
                                    replyTarget = target
                                    draft = ""
                                },
                                onEdit = { target ->
                                    replyTarget = null
                                    editTarget = target
                                    draft = target.text
                                },
                                onDelete = { target ->
                                    scope.launch {
                                        deleteCommentTree(db, target.id, comments)
                                            .onFailure { onMessage("Could not delete comment. Try again.") }
                                    }
                                },
                            )
                        }
                    }
                }
            }

            if (replyTarget != null || editTarget != null) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (editTarget != null) "Editing your comment"
                            else "Replying to @${replyTarget?.userName.orEmpty()}",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.labelMedium,
                        )
                        IconButton(onClick = {
                            replyTarget = null
                            editTarget = null
                            draft = ""
                        }) { Icon(Icons.Default.Close, "Cancel") }
                    }
                }
            }

            HorizontalDivider()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 9.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                CommentAvatar(user?.photoUrl?.toString().orEmpty(), Modifier.size(36.dp))
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(700) },
                    modifier = Modifier.weight(1f),
                    enabled = user != null && !sending,
                    placeholder = {
                        Text(
                            when {
                                user == null -> "Sign in to comment"
                                editTarget != null -> "Edit comment"
                                replyTarget != null -> "Reply to @${replyTarget?.userName.orEmpty()}"
                                else -> "Add a comment…"
                            },
                        )
                    },
                    maxLines = 4,
                    shape = RoundedCornerShape(22.dp),
                )
                Spacer(Modifier.width(4.dp))
                IconButton(
                    enabled = user != null && draft.isNotBlank() && !sending,
                    onClick = {
                        val currentUser = user ?: return@IconButton
                        val text = draft.trim()
                        if (text.isBlank()) return@IconButton
                        val editing = editTarget
                        val replying = replyTarget
                        sending = true
                        scope.launch {
                            val result = when {
                                editing != null -> editComment(db, editing, currentUser, text)
                                replying != null -> postReply(db, classId, currentUser, replying, text)
                                else -> postTopLevelComment(db, classId, currentUser, text)
                            }
                            sending = false
                            result.onSuccess {
                                draft = ""
                                editTarget = null
                                replyTarget = null
                                if (replying != null && replying.userId.isNotBlank() && replying.userId != currentUser.uid) {
                                    launch {
                                        NativeCommentReplyPush.send(
                                            parentCommentId = replying.id,
                                            classId = classId,
                                            courseId = courseId,
                                            classTitle = classTitle,
                                            replyText = "@${replying.userName} $text",
                                        )
                                    }
                                }
                            }.onFailure { onMessage("Could not save comment. Try again.") }
                        }
                    },
                ) {
                    if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Icon(Icons.Default.Send, "Send")
                }
            }
        }
    }
}

@Composable
private fun YoutubeCommentThread(
    comment: YoutubeClassComment,
    repliesByParent: Map<String, List<YoutubeClassComment>>,
    currentUser: FirebaseUser?,
    depth: Int,
    onReply: (YoutubeClassComment) -> Unit,
    onEdit: (YoutubeClassComment) -> Unit,
    onDelete: (YoutubeClassComment) -> Unit,
) {
    val replies = repliesByParent[comment.id].orEmpty()
    var expanded by remember(comment.id) { mutableStateOf(depth < 2) }
    var menuOpen by remember(comment.id) { mutableStateOf(false) }
    val canManage = currentUser?.uid == comment.userId
    val indent = (depth.coerceAtMost(4) * 18).dp

    Column(Modifier.fillMaxWidth().padding(start = 12.dp + indent, end = 12.dp, top = 9.dp, bottom = 4.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            CommentAvatar(comment.userPhoto, Modifier.size(if (depth == 0) 36.dp else 30.dp))
            Spacer(Modifier.width(9.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("@${comment.userName}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(6.dp))
                    if (comment.timestamp > 0L) {
                        Text(commentRelativeTime(comment.timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (comment.editedAt > 0L) {
                        Spacer(Modifier.width(4.dp))
                        Text("edited", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.weight(1f))
                    if (canManage) {
                        Box {
                            IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(32.dp)) {
                                Icon(Icons.Default.MoreVert, "Comment options", Modifier.size(18.dp))
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text("Edit") },
                                    leadingIcon = { Icon(Icons.Default.Edit, null) },
                                    onClick = { menuOpen = false; onEdit(comment) },
                                )
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    leadingIcon = { Icon(Icons.Default.Delete, null) },
                                    onClick = { menuOpen = false; onDelete(comment) },
                                )
                            }
                        }
                    }
                }
                Text(comment.displayText(), style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { onReply(comment) }) {
                        Icon(Icons.Default.Reply, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Reply")
                    }
                    if (replies.isNotEmpty()) {
                        TextButton(onClick = { expanded = !expanded }) {
                            Text(if (expanded) "Hide replies" else "${replies.size} ${if (replies.size == 1) "reply" else "replies"}")
                        }
                    }
                }
            }
        }
        if (expanded && replies.isNotEmpty() && depth < 10) {
            replies.forEach { reply ->
                YoutubeCommentThread(
                    comment = reply,
                    repliesByParent = repliesByParent,
                    currentUser = currentUser,
                    depth = depth + 1,
                    onReply = onReply,
                    onEdit = onEdit,
                    onDelete = onDelete,
                )
            }
        }
    }
}

private suspend fun postTopLevelComment(
    db: FirebaseFirestore,
    classId: String,
    user: FirebaseUser,
    text: String,
): Result<Unit> = runCatching {
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

private suspend fun postReply(
    db: FirebaseFirestore,
    classId: String,
    user: FirebaseUser,
    target: YoutubeClassComment,
    text: String,
): Result<Unit> = runCatching {
    withContext(Dispatchers.IO) {
        db.collection("classComments").add(
            mapOf(
                "classId" to classId,
                "userId" to user.uid,
                "userName" to (user.displayName ?: user.email ?: "Student"),
                "userPhoto" to (user.photoUrl?.toString() ?: ""),
                "text" to text,
                "parentId" to target.id,
                "isTopLevel" to false,
                "replyToUserId" to target.userId,
                "replyToUserName" to target.userName,
                "timestamp" to FieldValue.serverTimestamp(),
            ),
        ).await()
    }
}

private suspend fun editComment(
    db: FirebaseFirestore,
    comment: YoutubeClassComment,
    user: FirebaseUser,
    text: String,
): Result<Unit> = runCatching {
    require(comment.userId == user.uid) { "Only your own comment can be edited" }
    withContext(Dispatchers.IO) {
        db.collection("classComments").document(comment.id)
            .update(mapOf("text" to text, "editedAt" to FieldValue.serverTimestamp()))
            .await()
    }
}

private suspend fun deleteCommentTree(
    db: FirebaseFirestore,
    rootId: String,
    comments: List<YoutubeClassComment>,
): Result<Unit> = runCatching {
    val children = comments.groupBy { it.parentId }
    val ids = linkedSetOf<String>()
    fun visit(id: String) {
        if (!ids.add(id)) return
        children[id].orEmpty().forEach { visit(it.id) }
    }
    visit(rootId)
    withContext(Dispatchers.IO) {
        ids.chunked(400).forEach { chunk ->
            val batch = db.batch()
            chunk.forEach { batch.delete(db.collection("classComments").document(it)) }
            batch.commit().await()
        }
    }
}

@Composable
private fun CommentAvatar(url: String, modifier: Modifier) {
    if (url.isNotBlank()) {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(CircleShape),
        )
    } else {
        Surface(modifier = modifier, shape = CircleShape, color = MaterialTheme.colorScheme.surface) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Person, null, Modifier.size(18.dp))
            }
        }
    }
}

private fun YoutubeClassComment.displayText(): String =
    if (replyToUserName.isBlank()) text else "@${replyToUserName} $text"

private fun commentMillis(value: Any?): Long = when (value) {
    is Timestamp -> value.toDate().time
    is Date -> value.time
    is Number -> value.toLong()
    else -> 0L
}

private fun commentRelativeTime(time: Long): String {
    val delta = (System.currentTimeMillis() - time).coerceAtLeast(0L)
    return when {
        delta < 60_000L -> "now"
        delta < 3_600_000L -> "${delta / 60_000L}m"
        delta < 86_400_000L -> "${delta / 3_600_000L}h"
        delta < 604_800_000L -> "${delta / 86_400_000L}d"
        delta < 2_592_000_000L -> "${delta / 604_800_000L}w"
        delta < 31_536_000_000L -> "${delta / 2_592_000_000L}mo"
        else -> "${delta / 31_536_000_000L}y"
    }
}
