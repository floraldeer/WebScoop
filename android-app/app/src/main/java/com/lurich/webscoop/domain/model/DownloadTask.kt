package com.lurich.webscoop.domain.model

import java.net.URI
import java.time.Instant
import java.util.UUID

enum class DownloadStatus {
    PENDING,
    RESOLVING,
    READY,
    DOWNLOADING,
    COMPLETED,
    FAILED,
    CANCELED,
}

data class DownloadTask(
    val publicID: String = UUID.randomUUID().toString(),
    val sourceUrl: URI,
    val platform: Platform,
    val status: DownloadStatus = DownloadStatus.PENDING,
    val progress: Int = 0,
    val title: String = "",
    val errorMessage: String = "",
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = createdAt,
) {
    init {
        require(publicID.isNotBlank()) { "publicID must not be blank" }
        require(sourceUrl.scheme in setOf("http", "https")) { "sourceUrl must use HTTP(S)" }
        require(progress in 0..100) { "progress must be between 0 and 100" }
    }

    fun transitionTo(
        nextStatus: DownloadStatus,
        nextProgress: Int = progress,
        now: Instant = Instant.now(),
    ): DownloadTask {
        require(nextStatus in allowedTransitions.getValue(status)) {
            "Illegal download transition: $status -> $nextStatus"
        }
        return copy(
            status = nextStatus,
            progress = if (nextStatus == DownloadStatus.COMPLETED) 100 else nextProgress,
            updatedAt = now,
        )
    }

    private companion object {
        val allowedTransitions = mapOf(
            DownloadStatus.PENDING to setOf(
                DownloadStatus.RESOLVING,
                DownloadStatus.CANCELED,
            ),
            DownloadStatus.RESOLVING to setOf(
                DownloadStatus.READY,
                DownloadStatus.FAILED,
                DownloadStatus.CANCELED,
            ),
            DownloadStatus.READY to setOf(
                DownloadStatus.DOWNLOADING,
                DownloadStatus.CANCELED,
            ),
            DownloadStatus.DOWNLOADING to setOf(
                DownloadStatus.COMPLETED,
                DownloadStatus.FAILED,
                DownloadStatus.CANCELED,
            ),
            DownloadStatus.FAILED to setOf(
                DownloadStatus.PENDING,
                DownloadStatus.CANCELED,
            ),
            DownloadStatus.CANCELED to setOf(DownloadStatus.PENDING),
            DownloadStatus.COMPLETED to emptySet(),
        )
    }
}
