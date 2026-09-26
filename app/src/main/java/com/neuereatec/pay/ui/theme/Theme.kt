package com.neuereatec.pay.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val NeuereatecPrimary = Color(0xFF1A365D)
val NeuereatecPrimaryDeep = Color(0xFF0F2744)
val NeuereatecTeal = Color(0xFF0D9488)
val NeuereatecAccent = Color(0xFF38A169)
val NeuereatecCream = Color(0xFFF7FAFC)
val NeuereatecMuted = Color(0xFF718096)
val NeuereatecSuccess = Color(0xFF38A169)
val NeuereatecError = Color(0xFFC53030)

private val LightColors = lightColorScheme(
    primary = NeuereatecPrimary,
    onPrimary = Color.White,
    primaryContainer = NeuereatecTeal,
    onPrimaryContainer = Color.White,
    secondary = NeuereatecAccent,
    onSecondary = Color.White,
    background = NeuereatecCream,
    onBackground = NeuereatecPrimaryDeep,
    surface = Color.White,
    onSurface = NeuereatecPrimaryDeep,
    surfaceVariant = Color(0xFFEDF2F7),
    onSurfaceVariant = NeuereatecMuted,
    error = NeuereatecError,
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
fun NeuereatecPayTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = Typography,
        content = content,
    )
}
