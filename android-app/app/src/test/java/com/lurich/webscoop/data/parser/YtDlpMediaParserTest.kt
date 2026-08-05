package com.lurich.webscoop.data.parser

import com.lurich.webscoop.data.cookie.PlatformCookieStore
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.model.Platform
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.ParseFailure
import java.net.URI
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YtDlpMediaParserTest {
    private val link = SupportedLink(URI("https://youtu.be/video"), Platform.YOUTUBE)

    @Test
    fun `parses public media anonymously and maps structured video info`() = runBlocking {
        var command: YtDlpCommand? = null
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                command = it
                YtDlpVideo(
                    mediaUrl = "https://media.example/video.mp4",
                    title = "Video",
                    uploader = "Creator",
                    format = "720p",
                    resolution = "1280x720",
                    extension = "mp4",
                    sizeBytes = 1024,
                    webpageUrl = link.url.toString(),
                )
            },
            cookieStore = PlatformCookieStore { "session=secret" },
        )

        val result = parser.parse(link)

        assertTrue(result is MediaParseResult.Success)
        result as MediaParseResult.Success
        assertEquals("Video", result.media.title)
        assertEquals("mp4", result.media.format)
        assertEquals(1024, result.media.sizeBytes)
        assertTrue(command!!.options.contains("--no-playlist" to null))
        assertTrue(command!!.options.contains("--socket-timeout" to "15"))
        assertTrue(command!!.options.contains("--retries" to "2"))
        assertTrue(command!!.options.contains("--extractor-retries" to "2"))
        assertTrue(command!!.cookieHeader.isBlank())
    }

    @Test
    fun `returns a retryable failure when parsing exceeds the total timeout`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine { awaitCancellation() },
            cookieStore = PlatformCookieStore { "" },
            parseTimeoutMillis = 10,
        )

        val result = parser.parse(link) as MediaParseResult.Failure

        assertEquals(
            ParseFailure.RemoteError("解析超时，请检查网络后重试"),
            result.failure,
        )
    }

    @Test
    fun `propagates cancellation instead of converting it to a parse failure`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine { awaitCancellation() },
            cookieStore = PlatformCookieStore { "" },
        )

        val parseJob = launch { parser.parse(link) }
        yield()
        parseJob.cancelAndJoin()

        assertTrue(parseJob.isCancelled)
    }

    @Test
    fun `does not add an empty cookie header`() = runBlocking {
        var command: YtDlpCommand? = null
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                command = it
                video()
            },
            cookieStore = PlatformCookieStore { "" },
        )

        parser.parse(link)

        assertTrue(command!!.cookieHeader.isBlank())
    }

    @Test
    fun `retries an authentication failure with scoped cookie data`() = runBlocking {
        val commands = mutableListOf<YtDlpCommand>()
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                commands += it
                if (commands.size == 1) error("Login required")
                video()
            },
            cookieStore = PlatformCookieStore { "session=secret" },
        )

        val result = parser.parse(link)

        assertTrue(result is MediaParseResult.Success)
        assertEquals(2, commands.size)
        assertTrue(commands.first().cookieHeader.isBlank())
        assertEquals("session=secret", commands.last().cookieHeader)
        assertEquals("www.youtube.com", commands.last().cookieDomain)
    }

    @Test
    fun `classifies login failures without exposing remote URL`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                error("Sign in required, see https://private.example/token")
            },
            cookieStore = PlatformCookieStore { "" },
        )

        val result = parser.parse(link)

        assertEquals(
            MediaParseResult.Failure(ParseFailure.LoginRequired),
            result,
        )
    }

    @Test
    fun `does not classify deprecated cookie header errors as login required`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                error("Deprecated Feature: Passing cookies as a header is a potential security risk")
            },
            cookieStore = PlatformCookieStore { "session=secret" },
        )

        val result = parser.parse(link) as MediaParseResult.Failure

        assertTrue(result.failure is ParseFailure.RemoteError)
    }

    @Test
    fun `rejects non HTTP media URLs`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine { video().copy(mediaUrl = "file:///tmp/video.mp4") },
            cookieStore = PlatformCookieStore { "" },
        )

        val result = parser.parse(link)

        assertEquals(
            MediaParseResult.Failure(ParseFailure.UnsupportedContent),
            result,
        )
    }

    @Test
    fun `redacts cookie values from remote errors`() = runBlocking {
        val parser = YtDlpMediaParser(
            engine = YtDlpEngine {
                error("Extractor failed with session=secret at https://private.example/video")
            },
            cookieStore = PlatformCookieStore { "session=secret" },
        )

        val result = parser.parse(link) as MediaParseResult.Failure
        val message = (result.failure as ParseFailure.RemoteError).message

        assertFalse(message.contains("session=secret"))
        assertFalse(message.contains("private.example"))
    }

    private fun video() = YtDlpVideo(
        mediaUrl = "https://media.example/video.mp4",
        title = "Video",
        uploader = "",
        format = "best",
        resolution = "",
        extension = "mp4",
        sizeBytes = 0,
        webpageUrl = link.url.toString(),
    )
}
