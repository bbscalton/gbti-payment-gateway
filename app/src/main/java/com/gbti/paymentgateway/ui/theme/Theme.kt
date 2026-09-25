package com.gbti.paymentgateway.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val GbtiNavy = Color(0xFF0B3D5C)
val GbtiNavyDeep = Color(0xFF072A40)
val GbtiTeal = Color(0xFF1A5F7A)
val GbtiGold = Color(0xFFC9A227)
val GbtiCream = Color(0xFFF7F5F0)
val GbtiMuted = Color(0xFF5A6B75)
val GbtiSuccess = Color(0xFF1F6F4A)
val GbtiError = Color(0xFF9B2C2C)

private val LightColors = lightColorScheme(
    primary = GbtiNavy,
    onPrimary = Color.White,
    primaryContainer = GbtiTeal,
    onPrimaryContainer = Color.White,
    secondary = GbtiGold,
    onSecondary = GbtiNavyDeep,
    background = GbtiCream,
    onBackground = GbtiNavyDeep,
    surface = Color.White,
    onSurface = GbtiNavyDeep,
    surfaceVariant = Color(0xFFECE7DB),
    onSurfaceVariant = GbtiMuted,
    error = GbtiError,
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
fun GbtiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = Typography,
        content = content,
    )
}
