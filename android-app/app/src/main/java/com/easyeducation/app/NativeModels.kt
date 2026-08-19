package com.easyeducation.app

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import org.json.JSONArray
import org.json.JSONObject

private fun Any?.jsonSafe(): Any? = when (this) {
    null -> JSONObject.NULL
    is String, is Number, is Boolean -> this
    is Timestamp -> this.toDate().time
    is Map<*, *> -> JSONObject().also { target ->
        for ((key, value) in this) if (key != null) target.put(key.toString(), value.jsonSafe())
    }
    is Iterable<*> -> JSONArray().also { target -> this.forEach { target.put(it.jsonSafe()) } }
    else -> toString()
}

fun DocumentSnapshot.toCacheJson(): JSONObject = JSONObject().also { target ->
    target.put("id", id)
    for ((key, value) in (data ?: emptyMap())) target.put(key, value.jsonSafe())
}

private fun JSONObject.stringList(vararg keys: String): List<String> {
    for (key in keys) {
        if (!has(key) || isNull(key)) continue
        when (val raw = opt(key)) {
            is JSONArray -> return buildList {
                for (index in 0 until raw.length()) {
                    val value = raw.opt(index)?.toString()?.trim().orEmpty()
                    if (value.isNotBlank()) add(value)
                }
            }
            is String -> if (raw.isNotBlank()) return listOf(raw.trim())
        }
    }
    return emptyList()
}

private fun JSONObject.firstString(vararg keys: String): String {
    for (key in keys) {
        val value = optString(key).trim()
        if (value.isNotBlank()) return value
    }
    return ""
}

private fun JSONObject.millis(key: String): Long {
    val raw = opt(key)
    return when (raw) {
        is Number -> raw.toLong()
        is String -> raw.toLongOrNull() ?: 0L
        else -> 0L
    }
}

data class NativeCourse(
    val id: String,
    val title: String,
    val description: String,
    val thumbnailUrl: String,
    val price: Double,
    val courseFormat: String,
) {
    companion object {
        fun from(json: JSONObject) = NativeCourse(
            id = json.optString("id"),
            title = json.firstString("title", "name").ifBlank { "Course" },
            description = json.optString("description"),
            thumbnailUrl = json.firstString("thumbnailURL", "imageURL", "image", "thumbnail"),
            price = json.optDouble("price", 0.0),
            courseFormat = json.optString("courseFormat", "single"),
        )
    }
}

data class NativeSubject(
    val id: String,
    val courseId: String,
    val title: String,
    val order: Int,
) {
    companion object {
        fun from(json: JSONObject) = NativeSubject(
            id = json.optString("id"),
            courseId = json.optString("courseId"),
            title = json.firstString("title", "name", "subject").ifBlank { "Subject" },
            order = json.optInt("order", 0),
        )
    }
}

data class NativeChapter(
    val id: String,
    val courseId: String,
    val subject: String,
    val title: String,
    val order: Int,
) {
    companion object {
        fun from(json: JSONObject) = NativeChapter(
            id = json.optString("id"),
            courseId = json.optString("courseId"),
            subject = json.stringList("subject").firstOrNull().orEmpty(),
            title = json.firstString("title", "name", "chapter").ifBlank { "Chapter" },
            order = json.optInt("order", 0),
        )
    }
}

data class NativeClassItem(
    val id: String,
    val courseId: String,
    val title: String,
    val topic: String,
    val subjects: List<String>,
    val chapters: List<String>,
    val order: Int,
    val duration: String,
    val sourceUrl: String,
    val downloadUrl: String,
    val teacherName: String,
) {
    companion object {
        fun from(json: JSONObject) = NativeClassItem(
            id = json.optString("id"),
            courseId = json.optString("courseId"),
            title = json.firstString("title", "topic").ifBlank { "Class" },
            topic = json.optString("topic"),
            subjects = json.stringList("subject", "subjects"),
            chapters = json.stringList("chapter", "chapters"),
            order = json.optInt("order", 0),
            duration = json.optString("duration"),
            // Prefer the site's streaming source for normal online playback.
            sourceUrl = json.firstString(
                "hlsLink",
                "videoURL",
                "videoUrl",
                "youtubeLink",
                "rumbleLink",
                "driveLink",
                "dailymotionLink",
            ),
            // Prefer sources that can be turned into an encrypted progressive offline copy.
            downloadUrl = json.firstString(
                "youtubeLink",
                "rumbleLink",
                "videoURL",
                "videoUrl",
                "hlsLink",
                "driveLink",
                "dailymotionLink",
            ),
            teacherName = json.stringList("teacherName").joinToString(", ").ifBlank {
                json.optString("teacherName")
            },
        )
    }
}

data class NativeEnrollment(
    val id: String,
    val userId: String,
    val courseId: String,
) {
    companion object {
        fun from(json: JSONObject) = NativeEnrollment(
            id = json.optString("id"),
            userId = json.optString("userId"),
            courseId = json.optString("courseId"),
        )
    }
}

data class NativeUserProfile(
    val uid: String,
    val name: String,
    val email: String,
    val role: String,
    val banned: Boolean,
    val permanentBan: Boolean,
    val banExpiresAt: Long,
) {
    fun restrictionMessage(now: Long = System.currentTimeMillis()): String? {
        if (permanentBan) return "This account is permanently restricted. Please contact support."
        if (banned && banExpiresAt <= 0L) return "This account has been restricted by an administrator. Please contact support."
        if (banExpiresAt > now) return "This account is temporarily restricted. Please try again after the restriction expires."
        return null
    }

    companion object {
        fun from(uid: String, json: JSONObject?) = NativeUserProfile(
            uid = uid,
            name = json?.firstString("name", "displayName") ?: "",
            email = json?.optString("email") ?: "",
            role = json?.optString("role", "user") ?: "user",
            banned = json?.optBoolean("banned", false) ?: false,
            permanentBan = json?.optBoolean("permanentBan", false) ?: false,
            banExpiresAt = json?.millis("banExpiresAt") ?: 0L,
        )
    }
}

data class NativeCourseContent(
    val course: NativeCourse?,
    val subjects: List<NativeSubject>,
    val chapters: List<NativeChapter>,
    val classes: List<NativeClassItem>,
)
