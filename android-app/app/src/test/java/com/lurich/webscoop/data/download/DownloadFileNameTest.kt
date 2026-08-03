package com.lurich.webscoop.data.download

import com.lurich.webscoop.domain.parser.ParsedMedia
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class DownloadFileNameTest {
    @Test
    fun `builds a safe file name with parsed extension`() {
        val name = DownloadFileName.from(media(title = """A/B:C*D?"E"""", format = "MP4"))

        assertEquals("A_B_C_D__E_.mp4", name)
    }

    @Test
    fun `falls back for blank titles and unsafe extensions`() {
        val name = DownloadFileName.from(media(title = "  ", format = "../exe"))

        assertEquals("WebScoop.mp4", name)
    }

    @Test
    fun `replaces line breaks from remote titles`() {
        val name = DownloadFileName.from(media(title = "标题 \n#标签", format = "mp4"))

        assertEquals("标题 __标签.mp4", name)
    }

    @Test
    fun `limits excessively long names`() {
        val name = DownloadFileName.from(media(title = "a".repeat(300), format = "webm"))

        assertFalse(name.substringBeforeLast('.').length > 120)
        assertEquals("webm", name.substringAfterLast('.'))
    }

    @Test
    fun `matches original and numbered duplicate names`() {
        val preferred = "视频.mp4"

        assertEquals(true, DownloadFileName.matchesExisting("视频.mp4", preferred))
        assertEquals(true, DownloadFileName.matchesExisting("视频-2.mp4", preferred))
        assertEquals(true, DownloadFileName.matchesExisting("视频 (2).mp4", preferred))
        assertEquals(false, DownloadFileName.matchesExisting("其他视频.mp4", preferred))
        assertEquals(false, DownloadFileName.matchesExisting("视频.mp3", preferred))
    }

    private fun media(title: String, format: String) = ParsedMedia(
        sourceUrl = URI("https://example.com/source"),
        mediaUrl = URI("https://example.com/media"),
        title = title,
        format = format,
    )
}
