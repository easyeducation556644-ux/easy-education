package com.easyeducation.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val EasyLight = lightColorScheme(
    primary = Color(0xFF171717),
    onPrimary = Color(0xFFFCFCFC),
    primaryContainer = Color(0xFFF2F2F2),
    onPrimaryContainer = Color(0xFF171717),
    secondary = Color(0xFF666666),
    onSecondary = Color.White,
    background = Color(0xFFFAFAFA),
    onBackground = Color(0xFF171717),
    surface = Color.White,
    onSurface = Color(0xFF171717),
    surfaceVariant = Color(0xFFF3F3F3),
    onSurfaceVariant = Color(0xFF666666),
    outline = Color(0xFFE4E4E4),
    outlineVariant = Color(0xFFEDEDED),
    error = Color(0xFFD93636),
    onError = Color.White,
)

private val EasyDark = darkColorScheme(
    primary = Color(0xFFF7F7F7),
    onPrimary = Color(0xFF111111),
    primaryContainer = Color(0xFF282828),
    onPrimaryContainer = Color(0xFFF7F7F7),
    secondary = Color(0xFFA8A8A8),
    onSecondary = Color(0xFF111111),
    background = Color(0xFF101010),
    onBackground = Color(0xFFF7F7F7),
    surface = Color(0xFF191919),
    onSurface = Color(0xFFF7F7F7),
    surfaceVariant = Color(0xFF252525),
    onSurfaceVariant = Color(0xFFBEBEBE),
    outline = Color(0xFF343434),
    outlineVariant = Color(0xFF2C2C2C),
    error = Color(0xFFFF6464),
    onError = Color.White,
)

private val EasyShapes = Shapes(
    extraSmall = RoundedCornerShape(7.dp),
    small = RoundedCornerShape(9.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(22.dp),
)

@Composable
fun EasyEducationTheme(
    themeMode: String = NativeThemePreferences.SYSTEM,
    content: @Composable () -> Unit,
) {
    val dark = when (themeMode) {
        NativeThemePreferences.LIGHT -> false
        NativeThemePreferences.DARK -> true
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) EasyDark else EasyLight,
        typography = Typography(),
        shapes = EasyShapes,
        content = content,
    )
}
