package com.neuereatec.sapp.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val SappPrimary = Color(0xFF1A365D)
val SappPrimaryDeep = Color(0xFF0F2744)
val SappTeal = Color(0xFF0D9488)
val SappAccent = Color(0xFF38A169)
val SappCream = Color(0xFFF7FAFC)
val SappMuted = Color(0xFF718096)
val SappSuccess = Color(0xFF38A169)
val SappError = Color(0xFFC53030)

private val LightColors = lightColorScheme(
    primary = SappPrimary,
    onPrimary = Color.White,
    primaryContainer = SappTeal,
    onPrimaryContainer = Color.White,
    secondary = SappAccent,
    onSecondary = Color.White,
    background = SappCream,
    onBackground = SappPrimaryDeep,
    surface = Color.White,
    onSurface = SappPrimaryDeep,
    surfaceVariant = Color(0xFFEDF2F7),
    onSurfaceVariant = SappMuted,
    error = SappError,
    onError = Color.White,
)

private val Typography = androidx.compose.material3.Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 36.sp,
        letterSpacing = 0.5.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Medium,
        fontSize = 20.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        letterSpacing = 0.4.sp,
    ),
)

@Composable
fun SappTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = Typography,
        content = content,
    )
}
