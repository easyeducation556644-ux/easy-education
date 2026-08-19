package com.easyeducation.app

import android.content.Context

class OfflineLeaseStore(context: Context) {
    private val prefs = context.getSharedPreferences("offline_entitlement_leases_v2", Context.MODE_PRIVATE)

    fun refresh(uid: String, courseIds: Collection<String>, now: Long = System.currentTimeMillis()) {
        val prefix = "$uid:"
        val active = courseIds.filter { it.isNotBlank() }.toSet()
        val editor = prefs.edit()
        prefs.all.keys.filter { it.startsWith(prefix) }
            .filter { it.removePrefix(prefix) !in active }
            .forEach(editor::remove)
        val expiresAt = now + LEASE_MS
        active.forEach { courseId -> editor.putLong("$uid:$courseId", expiresAt) }
        editor.apply()
    }

    fun isValid(uid: String, courseId: String, now: Long = System.currentTimeMillis()): Boolean =
        uid.isNotBlank() && courseId.isNotBlank() && prefs.getLong("$uid:$courseId", 0L) > now

    fun expiresAt(uid: String, courseId: String): Long = prefs.getLong("$uid:$courseId", 0L)

    fun clearUser(uid: String) {
        val prefix = "$uid:"
        val editor = prefs.edit()
        prefs.all.keys.filter { it.startsWith(prefix) }.forEach(editor::remove)
        editor.apply()
    }

    companion object {
        const val LEASE_DAYS = 7
        private const val LEASE_MS = LEASE_DAYS * 24L * 60L * 60L * 1000L
    }
}
