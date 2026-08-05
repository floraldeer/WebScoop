package com.lurich.webscoop.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class AppProgressTest {
    @Test
    fun parseProgressTextUsesElapsedStageBeforeThirtySeconds() {
        assertEquals("正在解析媒体 · 0秒", parseProgressText(-1))
        assertEquals("正在解析媒体 · 0秒", parseProgressText(0))
        assertEquals("正在解析媒体 · 29秒", parseProgressText(29))
    }

    @Test
    fun parseProgressTextUsesSlowNetworkStageFromThirtySeconds() {
        assertEquals("网络响应较慢 · 30秒", parseProgressText(30))
        assertEquals("网络响应较慢 · 45秒", parseProgressText(45))
    }
}
