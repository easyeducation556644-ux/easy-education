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
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        if (data["type"] != "new_class") return

        val classId = data["classId"].orEmpty()
        val classTitle = data["classTitle"].orEmpty().ifBlank { data["title"].orEmpty().ifBlank { "New class" } }
        val courseTitle = data["courseTitle"].orEmpty().ifBlank { "Course" }
        val subjectTitle = data["subjectTitle"].orEmpty().ifBlank { "Subject" }
        val chapterTitle = data["chapterTitle"].orEmpty().ifBlank { "Chapter" }
        val openPath = data["url"].orEmpty().ifBlank { "/my-courses" }

        createChannel()

        val openIntent = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OPEN_PATH, openPath)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendingIntent = PendingIntent.getActivity(
            this,
            ("class:$classId").hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val details = "Course: $courseTitle\nSubject: $subjectTitle\nChapter: $chapterTitle"
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(classTitle)
            .setContentText("$courseTitle • $subjectTitle • $chapterTitle")
            .setStyle(NotificationCompat.BigTextStyle().bigText(details))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(("learning:$classId").hashCode(), notification)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "New classes",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "New class alerts for courses you are enrolled in"
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "learning_updates"
        private const val PREFS = "easy_education_push"
        private const val KEY_LAST_FCM_TOKEN = "last_fcm_token"
    }
}
