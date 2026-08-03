package com.lurich.webscoop.domain.login

import com.lurich.webscoop.domain.model.Platform
import java.net.URI
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AllowedLoginHostTest {
    @Test
    fun `allows every platform login entry`() {
        Platform.entries.forEach { platform ->
            assertTrue(
                "${platform.displayName} login URL should be allowed",
                AllowedLoginHost.accepts(platform, platform.loginUrl),
            )
        }
    }

    @Test
    fun `allows QQ Music and approved authorization hosts`() {
        assertTrue(AllowedLoginHost.accepts(Platform.QQ_MUSIC, URI("https://y.qq.com/")))
        assertTrue(AllowedLoginHost.accepts(Platform.QQ_MUSIC, URI("https://xui.ptlogin2.qq.com/")))
        assertTrue(AllowedLoginHost.accepts(Platform.QQ_MUSIC, URI("https://open.weixin.qq.com/")))
    }

    @Test
    fun `rejects insecure and lookalike hosts`() {
        assertFalse(AllowedLoginHost.accepts(Platform.QQ_MUSIC, URI("http://y.qq.com/")))
        assertFalse(
            AllowedLoginHost.accepts(
                Platform.QQ_MUSIC,
                URI("https://y.qq.com.attacker.example/"),
            ),
        )
        assertFalse(AllowedLoginHost.accepts(Platform.QQ_MUSIC, URI("file:///sdcard/a.html")))
    }

    @Test
    fun `does not share unrelated login hosts across platforms`() {
        assertFalse(
            AllowedLoginHost.accepts(
                Platform.YOUTUBE,
                URI("https://open.weixin.qq.com/"),
            ),
        )
    }

    @Test
    fun `warns only for blocked main frame HTTPS navigation`() {
        assertTrue(
            AllowedLoginHost.shouldWarnBlockedNavigation(
                URI("https://attacker.example/"),
                isForMainFrame = true,
            ),
        )
        assertFalse(
            AllowedLoginHost.shouldWarnBlockedNavigation(
                URI("bytedance://dispatch_message/"),
                isForMainFrame = false,
            ),
        )
        assertFalse(
            AllowedLoginHost.shouldWarnBlockedNavigation(
                URI("https://attacker.example/"),
                isForMainFrame = false,
            ),
        )
    }
}
