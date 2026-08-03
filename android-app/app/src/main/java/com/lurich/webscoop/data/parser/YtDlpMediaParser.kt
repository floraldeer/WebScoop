package com.lurich.webscoop.data.parser

import com.lurich.webscoop.data.cookie.PlatformCookieStore
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser
import com.lurich.webscoop.domain.parser.ParseFailure
import com.lurich.webscoop.domain.parser.ParsedMedia
import java.net.URI

class YtDlpMediaParser(
    private val engine: YtDlpEngine,
    private val cookieStore: PlatformCookieStore,
) : MediaParser {
    override suspend fun parse(link: SupportedLink): MediaParseResult {
        val cookie = cookieStore.getCookieHeader(link)
        val options = buildList {
            add("--no-playlist" to null)
            add("--no-warnings" to null)
            add("--format" to "best[protocol^=http]/best")
            if (cookie.isNotBlank()) add("--add-header" to "Cookie:$cookie")
        }

        return try {
            val video = engine.getInfo(YtDlpCommand(link.url.toString(), options))
            val mediaUrl = URI(video.mediaUrl)
            if (mediaUrl.scheme !in setOf("http", "https")) {
                MediaParseResult.Failure(ParseFailure.UnsupportedContent)
            } else {
                MediaParseResult.Success(
                    ParsedMedia(
                        sourceUrl = link.url,
                        mediaUrl = mediaUrl,
                        title = video.title.ifBlank { link.platform.displayName },
                        uploader = video.uploader,
                        format = video.extension.ifBlank { video.format },
                        quality = video.resolution,
                        sizeBytes = video.sizeBytes.coerceAtLeast(0),
                        referer = video.webpageUrl
                            .takeIf(String::isNotBlank)
                            ?.let(::URI),
                    ),
                )
            }
        } catch (error: Exception) {
            val message = error.message.orEmpty()
            val failure = if (
                message.contains("login", ignoreCase = true) ||
                message.contains("cookie", ignoreCase = true) ||
                message.contains("sign in", ignoreCase = true)
            ) {
                ParseFailure.LoginRequired
            } else {
                ParseFailure.RemoteError(sanitizeError(message, cookie))
            }
            MediaParseResult.Failure(failure)
        }
    }

    private fun sanitizeError(message: String, cookie: String): String {
        return message
            .lineSequence()
            .firstOrNull()
            ?.let { line -> if (cookie.isBlank()) line else line.replace(cookie, "[Cookie已隐藏]") }
            ?.replace(Regex("""https?://\S+"""), "[链接已隐藏]")
            ?.take(200)
            ?.ifBlank { "yt-dlp 解析失败" }
            ?: "yt-dlp 解析失败"
    }
}
