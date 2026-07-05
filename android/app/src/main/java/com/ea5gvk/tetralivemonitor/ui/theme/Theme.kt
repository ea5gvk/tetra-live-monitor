package com.ea5gvk.tetralivemonitor.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Cyan = Color(0xFF22D3EE)
val CyanDim = Color(0xFF0E7490)
val Bg = Color(0xFF0B1220)
val Surface = Color(0xFF111A2B)
val SurfaceHi = Color(0xFF1A2740)
val OnBg = Color(0xFFE6EDF6)
val Muted = Color(0xFF8DA2BF)
val Ok = Color(0xFF34D399)
val Warn = Color(0xFFF59E0B)
val Danger = Color(0xFFEF4444)
val Border = Color(0xFF243149)

private val DarkColors = darkColorScheme(
    primary = Cyan,
    onPrimary = Color(0xFF042027),
    secondary = CyanDim,
    background = Bg,
    onBackground = OnBg,
    surface = Surface,
    onSurface = OnBg,
    surfaceVariant = SurfaceHi,
    onSurfaceVariant = Muted,
    error = Danger,
    outline = Border,
)

@Composable
fun TetraTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = DarkColors,
        content = content,
    )
}
