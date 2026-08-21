package com.easyeducation.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class EasyEducationMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_FCM_TOKEN, token)
            .apply()
        Thread {
            runCatching { NativePushRegistrar.register(applicationContext) }
        }.start()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        when (data["type"]) {
            "new_class" -> showNewClass(data)
            "comment_reply" -> showCommentReply(data)
        }
    }

    private fun showNewClass(data: Map<String, String>) {
        val classId = data["classId"].orEmpty()
        val classTitle = data["classTitle"].orEmpty().ifBlank { data["title"].orEmpty().ifBlank { "New class" } }
        val courseTitle = data["courseTitle"].orEmpty().ifBlank { "Course" }
        val subjectTitle = data["subjectTitle"].orEmpty().ifBlank { "Subject" }
        val chapterTitle = data["chapterTitle"].orEmpty().ifBlank { "Chapter" }
        val openPath = data["url"].orEmpty().ifBlank { "/my-courses" }

        createChannel(CLASS_CHANNEL_ID, "New classes", "New class alerts for courses you are enrolled in")
        val details = "Course: $courseTitle\nSubject: $subjectTitle\nChapter: $chapterTitle"
        val notification = NotificationCompat.Builder(this, CLASS_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(classTitle)
            .setContentText("$courseTitle • $subjectTitle • $chapterTitle")
            .setStyle(NotificationCompat.BigTextStyle().bigText(details))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent(openPath, "class:$classId"))
            .build()
        getSystemService(NotificationManager::class.java)
            .notify(("learning:$classId").hashCode(), notification)
    }

    private fun showCommentReply(data: Map<String, String>) {
        val classId = data["classId"].orEmpty()
        val parentCommentId = data["parentCommentId"].orEmpty()
        val title = data["title"].orEmpty().ifBlank { "New reply" }
        val body = data["body"].orEmpty().ifBlank { "Someone replied to your comment" }
        val openPath = data["url"].orEmpty().ifBlank { "/my-courses" }

        createChannel(
            REPLY_CHANNEL_ID,
            "Comment replies",
            "Replies to your class comments",
        )
        val notification = NotificationCompat.Builder(this, REPLY_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent(openPath, "reply:$classId:$parentCommentId"))
            .build()
        getSystemService(NotificationManager::class.java)
            .notify(("reply:$classId:$parentCommentId:${System.currentTimeMillis() / 1000L}").hashCode(), notification)
    }

    private fun openPendingIntent(openPath: String, key: String): PendingIntent {
        val openIntent = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OPEN_PATH, openPath)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this,
            key.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun createChannel(id: String, name: String, description: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
                this.description = description
            },
        )
    }

    companion object {
        private const val CLASS_CHANNEL_ID = "learning_updates"
        private const val REPLY_CHANNEL_ID = "comment_replies"
        private const val PREFS = "easy_education_push"
        private const val KEY_LAST_FCM_TOKEN = "last_fcm_token"
    }
}
