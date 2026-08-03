package com.lurich.webscoop.data.download

import android.content.Context

internal fun filterVisibleDownloadItems(
    items: List<DownloadQueueItem>,
    hiddenDownloadIDs: Set<Long>,
): List<DownloadQueueItem> {
    if (hiddenDownloadIDs.isEmpty()) return items
    return items.filterNot { it.downloadID in hiddenDownloadIDs }
}

internal class DownloadQueueVisibilityStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )
    @Volatile
    private var hiddenDownloadIDs = readHiddenDownloadIDs()

    @Synchronized
    fun hide(downloadIDs: Collection<Long>) {
        if (downloadIDs.isEmpty()) return
        hiddenDownloadIDs = hiddenDownloadIDs + downloadIDs
        persist()
    }

    @Synchronized
    fun filterVisible(items: List<DownloadQueueItem>): List<DownloadQueueItem> {
        val existingDownloadIDs = items.mapTo(mutableSetOf(), DownloadQueueItem::downloadID)
        val retainedHiddenIDs = hiddenDownloadIDs.intersect(existingDownloadIDs)
        if (retainedHiddenIDs.size != hiddenDownloadIDs.size) {
            hiddenDownloadIDs = retainedHiddenIDs
            persist()
        }
        return filterVisibleDownloadItems(items, hiddenDownloadIDs)
    }

    private fun readHiddenDownloadIDs(): Set<Long> {
        return preferences.getStringSet(KEY_HIDDEN_DOWNLOAD_IDS, emptySet())
            .orEmpty()
            .mapNotNull(String::toLongOrNull)
            .toSet()
    }

    private fun persist() {
        preferences.edit()
            .putStringSet(
                KEY_HIDDEN_DOWNLOAD_IDS,
                hiddenDownloadIDs.mapTo(mutableSetOf(), Long::toString),
            )
            .apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "download_queue_visibility"
        const val KEY_HIDDEN_DOWNLOAD_IDS = "hidden_download_ids"
    }
}
