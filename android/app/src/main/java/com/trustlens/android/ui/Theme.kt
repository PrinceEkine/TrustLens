package com.trustlens.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Bg = Color(0xFF0B1220)
private val Panel = Color(0xFF111A2E)
private val Accent = Color(0xFF34D399)
private val Accent2 = Color(0xFF60A5FA)

private val Scheme = darkColorScheme(
    primary = Accent,
    secondary = Accent2,
    background = Bg,
    surface = Panel,
    onPrimary = Color(0xFF06281C),
    onSecondary = Color(0xFF081C33),
    onBackground = Color(0xFFE8EEFC),
    onSurface = Color(0xFFE8EEFC),
)

@Composable
fun TrustLensTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
