package com.lurich.webscoop.data.parser

import com.lurich.webscoop.data.cookie.PlatformCookieStore
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.model.Platform
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.ParseFailure
import java.net.URI
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YtDlpMediaParserTest {
    private val link = SupportedLink(URI("https://youtu.be/video"), Platform.YOUTUBE)

    @Test
    fun `injects login cookie and maps structured video info`() = runBlocking {
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
        assertTrue(command!!.options.contains("--add-header" to "Cookie:session=secret"))
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

        assertFalse(command!!.options.any { it.first == "--add-header" })
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
