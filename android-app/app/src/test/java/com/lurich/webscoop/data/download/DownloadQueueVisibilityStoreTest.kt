package com.lurich.webscoop.data.download

import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadQueueVisibilityStoreTest {
    @Test
    fun `filters hidden download IDs`() {
        val items = listOf(item(1), item(2), item(3))

        assertEquals(
            listOf(1L, 3L),
            filterVisibleDownloadItems(items, setOf(2)).map(DownloadQueueItem::downloadID),
        )
    }

    @Test
    fun `keeps all downloads when no IDs are hidden`() {
        val items = listOf(item(1), item(2))

        assertEquals(items, filterVisibleDownloadItems(items, emptySet()))
    }

    @Test
    fun `ignores hidden IDs that are not in the queue`() {
        val items = listOf(item(1), item(2))

        assertEquals(items, filterVisibleDownloadItems(items, setOf(8, 9)))
    }

    private fun item(downloadID: Long) = DownloadQueueItem(
        downloadID = downloadID,
        title = "media-$downloadID",
        status = DownloadQueueStatus.COMPLETED,
        reason = 0,
        downloadedBytes = 100,
        totalBytes = 100,
        localUri = "",
    )
}
