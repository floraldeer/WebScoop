package com.lurich.webscoop.data.download

import android.app.DownloadManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadQueueItemTest {
    @Test
    fun `calculates bounded progress`() {
        assertEquals(50, item(downloaded = 50, total = 100).progressPercent)
        assertEquals(100, item(downloaded = 120, total = 100).progressPercent)
        assertEquals(0, item(downloaded = -1, total = 100).progressPercent)
        assertNull(item(downloaded = 0, total = -1).progressPercent)
    }

    @Test
    fun `identifies active states`() {
        assertTrue(item(status = DownloadQueueStatus.PENDING).isActive)
        assertTrue(item(status = DownloadQueueStatus.RUNNING).isActive)
        assertTrue(item(status = DownloadQueueStatus.PAUSED).isActive)
        assertFalse(item(status = DownloadQueueStatus.COMPLETED).isActive)
        assertFalse(item(status = DownloadQueueStatus.FAILED).isActive)
    }

    @Test
    fun `maps system download statuses`() {
        assertEquals(
            DownloadQueueStatus.PENDING,
            DownloadManager.STATUS_PENDING.toDownloadQueueStatus(),
        )
        assertEquals(
            DownloadQueueStatus.RUNNING,
            DownloadManager.STATUS_RUNNING.toDownloadQueueStatus(),
        )
        assertEquals(
            DownloadQueueStatus.COMPLETED,
            DownloadManager.STATUS_SUCCESSFUL.toDownloadQueueStatus(),
        )
        assertEquals(DownloadQueueStatus.UNKNOWN, 999.toDownloadQueueStatus())
    }

    private fun item(
        downloaded: Long = 0,
        total: Long = 0,
        status: DownloadQueueStatus = DownloadQueueStatus.RUNNING,
    ) = DownloadQueueItem(
        downloadID = 1,
        title = "media",
        status = status,
        reason = 0,
        downloadedBytes = downloaded,
        totalBytes = total,
        localUri = "",
    )
}
