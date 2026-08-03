package com.lurich.webscoop.data.parser

import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.model.Platform
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser
import com.lurich.webscoop.domain.parser.ParseFailure
import java.net.URI
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ParserRouterTest {
    private val ytDlpResult = MediaParseResult.Failure(ParseFailure.UnsupportedContent)
    private val qqMusicResult = MediaParseResult.Failure(ParseFailure.LoginRequired)
    private val wechatResult = MediaParseResult.Failure(ParseFailure.CaptureRequired)
    private val router = ParserRouter(
        ytDlpParser = MediaParser { ytDlpResult },
        qqMusicParser = MediaParser { qqMusicResult },
        wechatChannelsParser = MediaParser { wechatResult },
    )

    @Test
    fun `routes QQ Music to dedicated parser`() = runBlocking {
        val result = router.parse(link(Platform.QQ_MUSIC, "https://y.qq.com/n/ryqq/songDetail/a"))

        assertEquals(qqMusicResult, result)
    }

    @Test
    fun `routes WeChat Channels to dedicated parser`() = runBlocking {
        val result = router.parse(
            link(Platform.WECHAT_CHANNELS, "https://channels.weixin.qq.com/web/pages/feed"),
        )

        assertEquals(wechatResult, result)
    }

    @Test
    fun `routes other platforms to yt-dlp`() = runBlocking {
        val result = router.parse(link(Platform.YOUTUBE, "https://youtu.be/a"))

        assertEquals(ytDlpResult, result)
    }

    private fun link(platform: Platform, url: String) = SupportedLink(URI(url), platform)
}
