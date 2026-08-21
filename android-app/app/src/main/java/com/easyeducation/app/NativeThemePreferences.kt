package com.easyeducation.app

import android.content.Context

object NativeThemePreferences {
    const val SYSTEM = "system"
    const val LIGHT = "light"
    const val DARK = "dark"

    private const val PREFS = "native_ui_preferences_v2"
    private const val KEY_THEME = "theme_mode"

    fun mode(context: Context): String = context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_THEME, SYSTEM)
        .takeIf { it in setOf(SYSTEM, LIGHT, DARK) }
        ?: SYSTEM

    fun setMode(context: Context, mode: String) {
        val safeMode = mode.takeIf { it in setOf(SYSTEM, LIGHT, DARK) } ?: SYSTEM
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, safeMode)
            .apply()
    }
}
