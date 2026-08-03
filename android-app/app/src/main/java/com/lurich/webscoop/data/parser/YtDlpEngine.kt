package com.lurich.webscoop.data.parser

data class YtDlpCommand(
    val url: String,
    val options: List<Pair<String, String?>>,
    val cookieHeader: String = "",
    val cookieDomain: String = "",
)

data class YtDlpVideo(
    val mediaUrl: String,
    val title: String,
    val uploader: String,
    val format: String,
    val resolution: String,
    val extension: String,
    val sizeBytes: Long,
    val webpageUrl: String,
)

fun interface YtDlpEngine {
    suspend fun getInfo(command: YtDlpCommand): YtDlpVideo
}
