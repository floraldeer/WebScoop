package com.lurich.webscoop.data.parser

import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.model.Platform
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser

class ParserRouter(
    private val ytDlpParser: MediaParser,
    private val qqMusicParser: MediaParser,
    private val wechatChannelsParser: MediaParser,
) : MediaParser {
    override suspend fun parse(link: SupportedLink): MediaParseResult {
        val parser = when (link.platform) {
            Platform.QQ_MUSIC -> qqMusicParser
            Platform.WECHAT_CHANNELS -> wechatChannelsParser
            else -> ytDlpParser
        }
        return parser.parse(link)
    }
}
