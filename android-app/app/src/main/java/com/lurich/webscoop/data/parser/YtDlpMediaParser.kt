package com.lurich.webscoop.data.parser

import com.lurich.webscoop.data.cookie.PlatformCookieStore
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser
import com.lurich.webscoop.domain.parser.ParseFailure
import com.lurich.webscoop.domain.parser.ParsedMedia
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

class YtDlpMediaParser(
    private val engine: YtDlpEngine,
    private val cookieStore: PlatformCookieStore,
    private val parseTimeoutMillis: Long = PARSE_TIMEOUT_MILLIS,
) : MediaParser {
    override suspend fun parse(link: SupportedLink): MediaParseResult {
        val cookie = cookieStore.getCookieHeader(link)
        val options = buildList<Pair<String, String?>> {
            add("--no-playlist" to null)
            add("--no-warnings" to null)
            add("--format" to "best[protocol^=http]/best")
            add("--socket-timeout" to SOCKET_TIMEOUT_SECONDS.toString())
            add("--retries" to RETRY_COUNT.toString())
            add("--extractor-retries" to RETRY_COUNT.toString())
        }

        return try {
            withTimeout(parseTimeoutMillis) {
                val anonymousCommand = YtDlpCommand(link.url.toString(), options)
                val video = try {
                    engine.getInfo(anonymousCommand)
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (anonymousError: Exception) {
                    if (
                        cookie.isBlank() ||
                        !isAuthenticationError(anonymousError.message.orEmpty())
                    ) {
                        throw anonymousError
                    }
                    engine.getInfo(
                        anonymousCommand.copy(
                            cookieHeader = cookie,
                            cookieDomain = link.platform.loginUrl.host.orEmpty(),
                        ),
                    )
                }
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
            }
        } catch (error: TimeoutCancellationException) {
            MediaParseResult.Failure(
                ParseFailure.RemoteError("解析超时，请检查网络后重试"),
            )
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            val message = error.message.orEmpty()
            val failure = if (isAuthenticationError(message)) {
                ParseFailure.LoginRequired
            } else {
                ParseFailure.RemoteError(sanitizeError(message, cookie))
            }
            MediaParseResult.Failure(failure)
        }
    }

    private fun isAuthenticationError(message: String): Boolean {
        return AUTHENTICATION_ERROR_PATTERNS.any { pattern ->
            message.contains(pattern, ignoreCase = true)
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

    private companion object {
        val AUTHENTICATION_ERROR_PATTERNS = listOf(
            "login required",
            "log in to",
            "not logged in",
            "sign in",
            "fresh cookies",
            "cookies are needed",
            "authentication required",
        )
        const val PARSE_TIMEOUT_MILLIS = 45_000L
        const val SOCKET_TIMEOUT_SECONDS = 15
        const val RETRY_COUNT = 2
    }
}
