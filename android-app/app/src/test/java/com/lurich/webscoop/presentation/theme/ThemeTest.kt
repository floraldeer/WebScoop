package com.lurich.webscoop.presentation.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeTest {
    @Test
    fun lightColorSchemeMatchesMacOSColorTokens() {
        assertEquals(Color(0xFF4F46E5), WebScoopLightColorScheme.primary)
        assertEquals(Color(0xFFEEF2FF), WebScoopLightColorScheme.primaryContainer)
        assertEquals(Color(0xFFF8FAFC), WebScoopLightColorScheme.background)
        assertEquals(Color(0xFFFFFFFF), WebScoopLightColorScheme.surface)
        assertEquals(Color(0xFF1E293B), WebScoopLightColorScheme.onSurface)
        assertEquals(Color(0xFF64748B), WebScoopLightColorScheme.secondary)
        assertEquals(Color(0xFFE2E8F0), WebScoopLightColorScheme.outline)
        assertEquals(Color(0xFF16A34A), WebScoopLightColorScheme.tertiary)
        assertEquals(Color(0xFFEF4444), WebScoopLightColorScheme.error)
    }
}
