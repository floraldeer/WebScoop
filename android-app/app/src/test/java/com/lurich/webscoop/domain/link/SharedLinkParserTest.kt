package com.lurich.webscoop.domain.link

import com.lurich.webscoop.domain.model.Platform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedLinkParserTest {
    @Test
    fun `recognizes every supported platform from shared text`() {
        val cases = mapOf(
            "https://channels.weixin.qq.com/web/pages/feed?exportkey=x" to Platform.WECHAT_CHANNELS,
            "https://v.douyin.com/abc/" to Platform.DOUYIN,
            "https://xhslink.com/a/abc" to Platform.XIAOHONGSHU,
            "https://v.kuaishou.com/abc" to Platform.KUAISHOU,
            "https://b23.tv/abc" to Platform.BILIBILI,
            "https://youtu.be/abc" to Platform.YOUTUBE,
            "https://x.com/user/status/1" to Platform.X,
            "https://www.tiktok.com/@user/video/1" to Platform.TIKTOK,
            "https://www.instagram.com/reel/abc/" to Platform.INSTAGRAM,
            "https://fb.watch/abc/" to Platform.FACEBOOK,
            "https://vimeo.com/123" to Platform.VIMEO,
            "https://m.weibo.cn/detail/123" to Platform.WEIBO,
            "https://y.qq.com/n/ryqq/songDetail/abc" to Platform.QQ_MUSIC,
        )

        cases.forEach { (url, platform) ->
            val result = SharedLinkParser.parse("复制这条分享内容 $url 打开应用")
            assertTrue("$url should be supported", result is LinkParseResult.Supported)
            assertEquals(platform, (result as LinkParseResult.Supported).link.platform)
        }
    }

    @Test
    fun `normalizes host case and strips trailing punctuation`() {
        val result = SharedLinkParser.parse("查看 https://WWW.YouTube.COM/watch?v=abc。")

        assertTrue(result is LinkParseResult.Supported)
        result as LinkParseResult.Supported
        assertEquals(Platform.YOUTUBE, result.link.platform)
        assertEquals("https://WWW.YouTube.COM/watch?v=abc", result.link.url.toString())
    }

    @Test
    fun `rejects lookalike domains`() {
        val result = SharedLinkParser.parse("https://youtube.com.attacker.example/watch?v=abc")

        assertTrue(result is LinkParseResult.Unsupported)
    }

    @Test
    fun `rejects non web links`() {
        assertTrue(SharedLinkParser.parse("file:///sdcard/video.mp4") is LinkParseResult.Unsupported)
        assertTrue(SharedLinkParser.parse("没有链接") is LinkParseResult.Unsupported)
    }
}
