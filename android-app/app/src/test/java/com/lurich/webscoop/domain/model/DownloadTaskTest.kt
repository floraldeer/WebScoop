package com.lurich.webscoop.domain.model

import java.net.URI
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DownloadTaskTest {
    private val task = DownloadTask(
        publicID = "public-task-1",
        sourceUrl = URI("https://youtu.be/example"),
        platform = Platform.YOUTUBE,
        createdAt = Instant.EPOCH,
    )

    @Test
    fun `moves through successful lifecycle`() {
        val completed = task
            .transitionTo(DownloadStatus.RESOLVING, now = Instant.ofEpochSecond(1))
            .transitionTo(DownloadStatus.READY, now = Instant.ofEpochSecond(2))
            .transitionTo(DownloadStatus.DOWNLOADING, nextProgress = 42)
            .transitionTo(DownloadStatus.COMPLETED)

        assertEquals(DownloadStatus.COMPLETED, completed.status)
        assertEquals(100, completed.progress)
    }

    @Test
    fun `allows retry after failure`() {
        val retried = task
            .transitionTo(DownloadStatus.RESOLVING)
            .transitionTo(DownloadStatus.FAILED)
            .transitionTo(DownloadStatus.PENDING, nextProgress = 0)

        assertEquals(DownloadStatus.PENDING, retried.status)
        assertEquals(0, retried.progress)
    }

    @Test
    fun `rejects invalid transition`() {
        assertThrows(IllegalArgumentException::class.java) {
            task.transitionTo(DownloadStatus.COMPLETED)
        }
    }

    @Test
    fun `rejects invalid progress`() {
        assertThrows(IllegalArgumentException::class.java) {
            task.copy(progress = 101)
        }
    }
}
