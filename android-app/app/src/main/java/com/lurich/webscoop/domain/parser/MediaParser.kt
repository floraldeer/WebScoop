package com.lurich.webscoop.domain.parser

import com.lurich.webscoop.domain.link.SupportedLink
import java.net.URI

data class ParsedMedia(
    val sourceUrl: URI,
    val mediaUrl: URI,
    val title: String,
    val uploader: String = "",
    val format: String = "",
    val quality: String = "",
    val sizeBytes: Long = 0,
    val referer: URI? = null,
    val isPreview: Boolean = false,
)

sealed interface ParseFailure {
    data object LoginRequired : ParseFailure

    data object CaptureRequired : ParseFailure

    data object UnsupportedContent : ParseFailure

    data class RemoteError(val message: String) : ParseFailure
}

sealed interface MediaParseResult {
    data class Success(val media: ParsedMedia) : MediaParseResult

    data class Failure(val failure: ParseFailure) : MediaParseResult
}

fun interface MediaParser {
    suspend fun parse(link: SupportedLink): MediaParseResult
}
