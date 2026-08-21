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
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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

private val HindSiliguri = FontFamily(
    Font(R.font.hind_siliguri_light, FontWeight.Light),
    Font(R.font.hind_siliguri_regular, FontWeight.Normal),
    Font(R.font.hind_siliguri_medium, FontWeight.Medium),
    Font(R.font.hind_siliguri_semibold, FontWeight.SemiBold),
    Font(R.font.hind_siliguri_bold, FontWeight.Bold),
)

private val BaseTypography = Typography()
private val EasyTypography = Typography(
    displayLarge = BaseTypography.displayLarge.copy(fontFamily = HindSiliguri),
    displayMedium = BaseTypography.displayMedium.copy(fontFamily = HindSiliguri),
    displaySmall = BaseTypography.displaySmall.copy(fontFamily = HindSiliguri),
    headlineLarge = BaseTypography.headlineLarge.copy(fontFamily = HindSiliguri),
    headlineMedium = BaseTypography.headlineMedium.copy(fontFamily = HindSiliguri),
    headlineSmall = BaseTypography.headlineSmall.copy(fontFamily = HindSiliguri),
    titleLarge = BaseTypography.titleLarge.copy(fontFamily = HindSiliguri),
    titleMedium = BaseTypography.titleMedium.copy(fontFamily = HindSiliguri),
    titleSmall = BaseTypography.titleSmall.copy(fontFamily = HindSiliguri),
    bodyLarge = BaseTypography.bodyLarge.copy(fontFamily = HindSiliguri),
    bodyMedium = BaseTypography.bodyMedium.copy(fontFamily = HindSiliguri),
    bodySmall = BaseTypography.bodySmall.copy(fontFamily = HindSiliguri),
    labelLarge = BaseTypography.labelLarge.copy(fontFamily = HindSiliguri),
    labelMedium = BaseTypography.labelMedium.copy(fontFamily = HindSiliguri),
    labelSmall = BaseTypography.labelSmall.copy(fontFamily = HindSiliguri),
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
        typography = EasyTypography,
        shapes = EasyShapes,
        content = content,
    )
}
