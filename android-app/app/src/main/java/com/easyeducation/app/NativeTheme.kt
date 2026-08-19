package com.easyeducation.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

// Mirrors the web app's Vercel-inspired black/white/gray token system.
private val EasyLight = lightColorScheme(
    primary = Color(0xFF242424),
    onPrimary = Color(0xFFFCFCFC),
    primaryContainer = Color(0xFFF2F2F2),
    onPrimaryContainer = Color(0xFF242424),
    secondary = Color(0xFF7A7A7A),
    onSecondary = Color.White,
    background = Color(0xFFFCFCFC),
    onBackground = Color(0xFF242424),
    surface = Color.White,
    onSurface = Color(0xFF242424),
    surfaceVariant = Color(0xFFF3F3F3),
    onSurfaceVariant = Color(0xFF777777),
    outline = Color(0xFFE5E5E5),
    outlineVariant = Color(0xFFEDEDED),
    error = Color(0xFFD93636),
    onError = Color.White,
)

private val EasyDark = darkColorScheme(
    primary = Color(0xFFF8F8F8),
    onPrimary = Color(0xFF141414),
    primaryContainer = Color(0xFF2A2A2A),
    onPrimaryContainer = Color(0xFFF8F8F8),
    secondary = Color(0xFFA5A5A5),
    onSecondary = Color(0xFF141414),
    background = Color(0xFF141414),
    onBackground = Color(0xFFF8F8F8),
    surface = Color(0xFF222222),
    onSurface = Color(0xFFF8F8F8),
    surfaceVariant = Color(0xFF2C2C2C),
    onSurfaceVariant = Color(0xFFBDBDBD),
    outline = Color(0xFF393939),
    outlineVariant = Color(0xFF303030),
    error = Color(0xFFFF5A5A),
    onError = Color.White,
)

private val EasyShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun EasyEducationTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) EasyDark else EasyLight,
        typography = Typography(),
        shapes = EasyShapes,
        content = content,
    )
}
