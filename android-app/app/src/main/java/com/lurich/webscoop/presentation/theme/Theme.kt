package com.lurich.webscoop.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val WebScoopColors = darkColorScheme(
    primary = Color(0xFF32D583),
    onPrimary = Color(0xFF052E1B),
    secondary = Color(0xFF8FA3B8),
    background = Color(0xFF0B1117),
    onBackground = Color(0xFFE8EEF5),
    surface = Color(0xFF121B24),
    onSurface = Color(0xFFE8EEF5),
    error = Color(0xFFFF6B6B),
)

@Composable
fun WebScoopTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WebScoopColors,
        content = content,
    )
}
