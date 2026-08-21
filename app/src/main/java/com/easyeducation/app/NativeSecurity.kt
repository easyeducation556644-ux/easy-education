package com.easyeducation.app

import android.content.Context

object NativeAccountSecurity {
    fun restrictionMessage(context: Context, uid: String): String? {
        if (uid.isBlank()) return "Sign in is required."
        val cached = NativeCacheDb(context.applicationContext).getDoc("users", uid)
        return NativeUserProfile.from(uid, cached).restrictionMessage()
    }
}
