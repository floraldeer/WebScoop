package com.lurich.webscoop.data.download

import android.app.DownloadManager
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.lurich.webscoop.data.cookie.PlatformCookieStore
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.domain.parser.ParsedMedia
import java.net.URLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

interface MediaDownloader {
    fun enqueue(link: SupportedLink, media: ParsedMedia): Long

    fun observeQueue(): Flow<List<DownloadQueueItem>>

    fun cancel(downloadID: Long): Boolean

    suspend fun clearQueueItems(items: Collection<DownloadQueueItem>): Int

    fun findExisting(media: ParsedMedia): ExistingDownload?

    fun openDownloads()
}

data class ExistingDownload(
    val fileName: String,
    val uri: Uri,
)

enum class DownloadQueueStatus {
    PENDING,
    RUNNING,
    PAUSED,
    COMPLETED,
    FAILED,
    UNKNOWN,
}

internal fun Int.toDownloadQueueStatus(): DownloadQueueStatus = when (this) {
    DownloadManager.STATUS_PENDING -> DownloadQueueStatus.PENDING
    DownloadManager.STATUS_RUNNING -> DownloadQueueStatus.RUNNING
    DownloadManager.STATUS_PAUSED -> DownloadQueueStatus.PAUSED
    DownloadManager.STATUS_SUCCESSFUL -> DownloadQueueStatus.COMPLETED
    DownloadManager.STATUS_FAILED -> DownloadQueueStatus.FAILED
    else -> DownloadQueueStatus.UNKNOWN
}

data class DownloadQueueItem(
    val downloadID: Long,
    val title: String,
    val status: DownloadQueueStatus,
    val reason: Int,
    val downloadedBytes: Long,
    val totalBytes: Long,
    val localUri: String,
) {
    val progressPercent: Int?
        get() = if (totalBytes > 0) {
            ((downloadedBytes.coerceIn(0, totalBytes) * 100) / totalBytes).toInt()
        } else {
            null
        }

    val isActive: Boolean
        get() = status in setOf(
            DownloadQueueStatus.PENDING,
            DownloadQueueStatus.RUNNING,
            DownloadQueueStatus.PAUSED,
        )
}

class SystemMediaDownloader(
    context: Context,
    private val cookieStore: PlatformCookieStore,
) : MediaDownloader {
    private val applicationContext = context.applicationContext
    private val downloadManager = requireNotNull(
        applicationContext.getSystemService(DownloadManager::class.java),
    )
    private val visibilityStore = DownloadQueueVisibilityStore(applicationContext)

    override fun enqueue(link: SupportedLink, media: ParsedMedia): Long {
        val fileName = DownloadFileName.from(media)
        val request = DownloadManager.Request(Uri.parse(media.mediaUrl.toString()))
            .setTitle(media.title)
            .setDescription("${link.platform.displayName} · ${media.quality}")
            .setMimeType(
                URLConnection.guessContentTypeFromName(fileName) ?: "application/octet-stream",
            )
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
            )

        media.referer?.let { request.addRequestHeader("Referer", it.toString()) }
        cookieStore.getCookieHeader(link)
            .takeIf(String::isNotBlank)
            ?.let { request.addRequestHeader("Cookie", it) }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                "WebScoop/$fileName",
            )
        } else {
            request.setDestinationInExternalFilesDir(
                applicationContext,
                Environment.DIRECTORY_DOWNLOADS,
                fileName,
            )
        }

        return downloadManager.enqueue(request)
    }

    override fun observeQueue(): Flow<List<DownloadQueueItem>> = flow {
        while (currentCoroutineContext().isActive) {
            emit(visibilityStore.filterVisible(readQueue()))
            delay(QUEUE_REFRESH_MILLIS)
        }
    }.flowOn(Dispatchers.IO)

    override fun cancel(downloadID: Long): Boolean {
        return downloadManager.remove(downloadID) > 0
    }

    override suspend fun clearQueueItems(
        items: Collection<DownloadQueueItem>,
    ): Int = withContext(Dispatchers.IO) {
        val distinctItems = items.distinctBy(DownloadQueueItem::downloadID)
        val currentItems = readQueue(
            distinctItems.map(DownloadQueueItem::downloadID).toLongArray(),
        ).associateBy(DownloadQueueItem::downloadID)
        val clearedDownloadIDs = distinctItems.mapNotNull { selectedItem ->
            val currentItem = currentItems[selectedItem.downloadID]
            when {
                currentItem == null -> selectedItem.downloadID
                !currentItem.isActive -> selectedItem.downloadID
                downloadManager.remove(selectedItem.downloadID) > 0 -> selectedItem.downloadID
                else -> null
            }
        }
        visibilityStore.hide(clearedDownloadIDs)
        clearedDownloadIDs.size
    }

    override fun findExisting(media: ParsedMedia): ExistingDownload? {
        val fileName = DownloadFileName.from(media)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val file = applicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?.listFiles()
                ?.firstOrNull { candidate ->
                    candidate.isFile && DownloadFileName.matchesExisting(candidate.name, fileName)
                }
            return file
                ?.let { ExistingDownload(it.name, Uri.fromFile(it)) }
        }

        val projection = arrayOf(
            MediaStore.Downloads._ID,
            MediaStore.Downloads.DISPLAY_NAME,
        )
        val selection = "${MediaStore.Downloads.RELATIVE_PATH} = ?"
        val arguments = arrayOf("${Environment.DIRECTORY_DOWNLOADS}/WebScoop/")
        return applicationContext.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            arguments,
            null,
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
            val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
            while (cursor.moveToNext()) {
                val existingName = cursor.getString(nameIndex).orEmpty()
                if (DownloadFileName.matchesExisting(existingName, fileName)) {
                    return@use ExistingDownload(
                        existingName,
                        ContentUris.withAppendedId(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            cursor.getLong(idIndex),
                        ),
                    )
                }
            }
            null
        }
    }

    override fun openDownloads() {
        val intent = Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        applicationContext.startActivity(intent)
    }

    private fun readQueue(downloadIDs: LongArray = longArrayOf()): List<DownloadQueueItem> {
        val query = DownloadManager.Query()
        if (downloadIDs.isNotEmpty()) query.setFilterById(*downloadIDs)
        return downloadManager.query(query).use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(cursor.toQueueItem())
            }.sortedByDescending(DownloadQueueItem::downloadID)
        }
    }

    private fun Cursor.toQueueItem(): DownloadQueueItem {
        return DownloadQueueItem(
            downloadID = getLong(getColumnIndexOrThrow(DownloadManager.COLUMN_ID)),
            title = getString(getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)).orEmpty(),
            status = getInt(
                getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS),
            ).toDownloadQueueStatus(),
            reason = getInt(getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
            downloadedBytes = getLong(
                getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
            ),
            totalBytes = getLong(
                getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
            ),
            localUri = getString(
                getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI),
            ).orEmpty(),
        )
    }

    private companion object {
        const val QUEUE_REFRESH_MILLIS = 1_000L
    }
}

object DownloadFileName {
    private val invalidCharacters = Regex("[\\u0000-\\u001F\\u007F\\\\/:*?\"<>|#]")
    private val validExtension = Regex("""^[a-zA-Z0-9]{1,8}$""")

    fun from(media: ParsedMedia): String {
        val baseName = media.title
            .replace(invalidCharacters, "_")
            .trim()
            .trimEnd('.')
            .take(120)
            .ifBlank { "WebScoop" }
        val extension = media.format
            .trim()
            .removePrefix(".")
            .takeIf(validExtension::matches)
            ?.lowercase()
            ?: "mp4"
        return "$baseName.$extension"
    }

    fun matchesExisting(existingName: String, preferredName: String): Boolean {
        if (existingName == preferredName) return true
        val extensionIndex = preferredName.lastIndexOf('.')
        if (extensionIndex <= 0) return false
        val baseName = Regex.escape(preferredName.substring(0, extensionIndex))
        val extension = Regex.escape(preferredName.substring(extensionIndex))
        return Regex("""^$baseName(?:-\d+| \(\d+\))$extension$""").matches(existingName)
    }
}
