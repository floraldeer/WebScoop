package com.lurich.webscoop.presentation

import android.content.ClipboardManager
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.lurich.webscoop.domain.link.LinkParseResult
import com.lurich.webscoop.domain.link.SharedLinkParser
import com.lurich.webscoop.domain.link.SupportedLink
import com.lurich.webscoop.data.cookie.WebViewCookieStore
import com.lurich.webscoop.data.download.MediaDownloader
import com.lurich.webscoop.data.download.DownloadQueueItem
import com.lurich.webscoop.data.download.DownloadQueueStatus
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser
import com.lurich.webscoop.domain.parser.ParseFailure
import com.lurich.webscoop.domain.parser.ParsedMedia
import com.lurich.webscoop.presentation.login.PlatformLoginDialog
import com.lurich.webscoop.presentation.theme.WebScoopTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebScoopApp(
    sharedText: StateFlow<String>,
    parser: MediaParser,
    cookieStore: WebViewCookieStore,
    downloader: MediaDownloader,
) {
    val context = LocalContext.current
    val incomingText by sharedText.collectAsState()
    val queueFlow = remember(downloader) { downloader.observeQueue() }
    val queueItems by queueFlow.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var parseResult by remember { mutableStateOf<MediaParseResult?>(null) }
    var downloadMessage by remember { mutableStateOf("") }
    var duplicateRequest by remember {
        mutableStateOf<Pair<SupportedLink, ParsedMedia>?>(null)
    }
    var duplicateFileName by remember { mutableStateOf("") }
    var isParsing by remember { mutableStateOf(false) }
    var parseJob by remember { mutableStateOf<Job?>(null) }
    var loginPlatform by remember { mutableStateOf<com.lurich.webscoop.domain.model.Platform?>(null) }
    val linkResult = remember(input) {
        if (input.isBlank()) null else SharedLinkParser.parse(input)
    }

    fun enqueueDownload(link: SupportedLink, media: ParsedMedia) {
        downloadMessage = runCatching {
            val downloadID = downloader.enqueue(link, media)
            "已加入系统下载队列，任务号：$downloadID"
        }.getOrElse { error ->
            error.message?.take(160) ?: "加入下载队列失败"
        }
    }

    fun pasteClipboard() {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        val text = clipboard
            ?.primaryClip
            ?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)
            ?.coerceToText(context)
            ?.toString()
            ?.trim()
            .orEmpty()
        if (text.isBlank() || SharedLinkParser.parse(text) is LinkParseResult.Unsupported) {
            Toast.makeText(context, "剪贴板中没有可用的媒体链接", Toast.LENGTH_SHORT).show()
            return
        }
        input = text
        parseResult = null
        downloadMessage = ""
    }

    LaunchedEffect(incomingText) {
        if (incomingText.isNotBlank()) {
            input = incomingText
            parseResult = null
            downloadMessage = ""
        }
    }

    WebScoopTheme {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("WebScoop", fontWeight = FontWeight.Bold)
                            Text(
                                "移动端全平台媒体工作区",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                    ),
                )
            },
        ) { contentPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(contentPadding)
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "粘贴分享链接",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "支持视频号、抖音、小红书、快手、B站、YouTube、X、TikTok、" +
                        "Instagram、Facebook、Vimeo、微博和 QQ 音乐。",
                    color = MaterialTheme.colorScheme.secondary,
                )
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = {
                                input = it
                                parseResult = null
                                downloadMessage = ""
                            },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 3,
                            label = { Text("链接或分享文案") },
                            placeholder = { Text("https://...") },
                            trailingIcon = {
                                TextButton(onClick = ::pasteClipboard) {
                                    Text("粘贴")
                                }
                            },
                            supportingText = {
                                when (linkResult) {
                                    is LinkParseResult.Supported ->
                                        Text("已识别：${linkResult.link.platform.displayName}")
                                    is LinkParseResult.Unsupported ->
                                        Text(
                                            linkResult.reason,
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                    null -> Text("可直接从目标应用分享至 WebScoop")
                                }
                            },
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Button(
                                onClick = {
                                    if (isParsing) {
                                        parseJob?.cancel()
                                        return@Button
                                    }
                                    val link = (linkResult as? LinkParseResult.Supported)?.link
                                        ?: return@Button
                                    isParsing = true
                                    parseResult = null
                                    downloadMessage = ""
                                    parseJob = scope.launch {
                                        try {
                                            parseResult = parser.parse(link)
                                        } finally {
                                            isParsing = false
                                            parseJob = null
                                        }
                                    }
                                },
                                enabled = isParsing || linkResult is LinkParseResult.Supported,
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                ),
                            ) {
                                if (isParsing) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.height(20.dp),
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text("取消解析")
                                } else {
                                    Text("解析媒体")
                                }
                            }
                            Button(
                                onClick = {
                                    input = ""
                                    parseResult = null
                                    downloadMessage = ""
                                },
                                enabled = input.isNotEmpty(),
                                colors = ButtonDefaults.outlinedButtonColors(),
                            ) {
                                Text("清空输入")
                            }
                        }
                        if (linkResult is LinkParseResult.Supported) {
                            Button(
                                onClick = { loginPlatform = linkResult.link.platform },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("登录${linkResult.link.platform.displayName}")
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                ParseResultCard(
                    result = parseResult,
                    downloadMessage = downloadMessage,
                    onDownload = { media ->
                        val link = (linkResult as? LinkParseResult.Supported)?.link
                            ?: return@ParseResultCard
                        val existing = downloader.findExisting(media)
                        if (existing == null) {
                            enqueueDownload(link, media)
                        } else {
                            duplicateRequest = link to media
                            duplicateFileName = existing.fileName
                        }
                    },
                )
                DownloadQueueSection(
                    items = queueItems,
                    onCancel = downloader::cancel,
                    onClear = downloader::clearQueueItems,
                    onOpenDownloads = downloader::openDownloads,
                )
            }
        }
    }

    loginPlatform?.let { platform ->
        PlatformLoginDialog(
            platform = platform,
            cookieStore = cookieStore,
            onDismiss = { loginPlatform = null },
        )
    }

    duplicateRequest?.let { (link, media) ->
        WebScoopTheme {
            AlertDialog(
                onDismissRequest = { duplicateRequest = null },
                title = { Text("文件已存在") },
                text = {
                    Text("系统下载目录中已存在“$duplicateFileName”，是否再次下载？")
                },
                confirmButton = {
                    Button(
                        onClick = {
                            duplicateRequest = null
                            enqueueDownload(link, media)
                        },
                    ) {
                        Text("再次下载")
                    }
                },
                dismissButton = {
                    Button(onClick = { duplicateRequest = null }) {
                        Text("取消")
                    }
                },
            )
        }
    }
}

@Composable
private fun DownloadQueueSection(
    items: List<DownloadQueueItem>,
    onCancel: (Long) -> Boolean,
    onClear: suspend (Collection<DownloadQueueItem>) -> Int,
    onOpenDownloads: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isManaging by remember { mutableStateOf(false) }
    var selectedDownloadIDs by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var isClearing by remember { mutableStateOf(false) }
    var pendingClearItems by remember {
        mutableStateOf<List<DownloadQueueItem>?>(null)
    }

    LaunchedEffect(items.map(DownloadQueueItem::downloadID)) {
        selectedDownloadIDs = selectedDownloadIDs.intersect(
            items.map(DownloadQueueItem::downloadID).toSet(),
        )
        if (items.isEmpty()) isManaging = false
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "下载队列（${items.size}）",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Button(onClick = onOpenDownloads) {
                Text("打开下载位置")
            }
        }
        if (items.isEmpty()) {
            Text("暂无下载任务", color = MaterialTheme.colorScheme.secondary)
        } else {
            if (isManaging) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "已选择 ${selectedDownloadIDs.size} 项",
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = {
                            selectedDownloadIDs = if (selectedDownloadIDs.size == items.size) {
                                emptySet()
                            } else {
                                items.map(DownloadQueueItem::downloadID).toSet()
                            }
                        },
                    ) {
                        Text(if (selectedDownloadIDs.size == items.size) "取消全选" else "全选")
                    }
                    TextButton(
                        onClick = {
                            isManaging = false
                            selectedDownloadIDs = emptySet()
                        },
                    ) {
                        Text("完成")
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Button(
                        onClick = {
                            pendingClearItems = items.filter {
                                it.downloadID in selectedDownloadIDs
                            }
                        },
                        enabled = selectedDownloadIDs.isNotEmpty(),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("清理所选")
                    }
                    Button(
                        onClick = { pendingClearItems = items },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Text("清理全部")
                    }
                }
            } else {
                Button(
                    onClick = { isManaging = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(),
                ) {
                    Text("管理下载列表")
                }
            }
            items.forEach { item ->
                val isSelected = item.downloadID in selectedDownloadIDs
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = isManaging) {
                            selectedDownloadIDs = if (isSelected) {
                                selectedDownloadIDs - item.downloadID
                            } else {
                                selectedDownloadIDs + item.downloadID
                            }
                        },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (isManaging) {
                                Checkbox(
                                    checked = isSelected,
                                    onCheckedChange = { checked ->
                                        selectedDownloadIDs = if (checked) {
                                            selectedDownloadIDs + item.downloadID
                                        } else {
                                            selectedDownloadIDs - item.downloadID
                                        }
                                    },
                                )
                            }
                            Text(
                                item.title.ifBlank { "下载任务 ${item.downloadID}" },
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Text(
                            item.status.displayText(item.reason),
                            color = if (item.status == DownloadQueueStatus.FAILED) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.secondary
                            },
                        )
                        val progress = item.progressPercent
                        if (progress != null) {
                            LinearProgressIndicator(
                                progress = { progress / 100f },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "$progress% · ${formatBytes(item.downloadedBytes)} / " +
                                    formatBytes(item.totalBytes),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        } else if (item.isActive) {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }
                        if (!isManaging && item.isActive) {
                            Button(
                                onClick = { onCancel(item.downloadID) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("取消下载")
                            }
                        } else if (
                            !isManaging &&
                            item.status == DownloadQueueStatus.COMPLETED
                        ) {
                            Button(
                                onClick = onOpenDownloads,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("查看下载内容")
                            }
                        }
                    }
                }
            }
        }
    }

    pendingClearItems?.let { pendingItems ->
        val activeCount = pendingItems.count(DownloadQueueItem::isActive)
        AlertDialog(
            onDismissRequest = {
                if (!isClearing) pendingClearItems = null
            },
            title = { Text("清理下载列表") },
            text = {
                Text(
                    buildString {
                        append("将清理 ${pendingItems.size} 条下载记录。")
                        if (activeCount > 0) {
                            append("其中 $activeCount 个进行中的任务会被取消。")
                        }
                        append("清理前已完成的媒体文件会保留在 Downloads/WebScoop。")
                        if (activeCount > 0) {
                            append("任务若在确认清理时刚好完成，系统可能同时移除其文件。")
                        }
                    },
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        isClearing = true
                        scope.launch {
                            val clearedCount = runCatching { onClear(pendingItems) }
                                .getOrElse {
                                    Toast.makeText(
                                        context,
                                        "清理失败，请稍后重试",
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                    isClearing = false
                                    return@launch
                                }
                            pendingClearItems = null
                            selectedDownloadIDs = emptySet()
                            isManaging = false
                            isClearing = false
                            val failedCount = pendingItems.size - clearedCount
                            Toast.makeText(
                                context,
                                if (failedCount == 0) {
                                    "已清理 $clearedCount 条下载记录"
                                } else {
                                    "已清理 $clearedCount 条，$failedCount 条活动任务取消失败"
                                },
                                Toast.LENGTH_SHORT,
                            ).show()
                        }
                    },
                    enabled = !isClearing,
                ) {
                    Text(if (isClearing) "正在清理…" else "确认清理")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingClearItems = null },
                    enabled = !isClearing,
                ) {
                    Text("取消")
                }
            },
        )
    }
}

private fun DownloadQueueStatus.displayText(reason: Int): String = when (this) {
    DownloadQueueStatus.PENDING -> "等待下载"
    DownloadQueueStatus.RUNNING -> "下载中"
    DownloadQueueStatus.PAUSED -> "已暂停（原因 $reason）"
    DownloadQueueStatus.COMPLETED -> "下载完成"
    DownloadQueueStatus.FAILED -> "下载失败（原因 $reason）"
    DownloadQueueStatus.UNKNOWN -> "未知状态"
}

private fun formatBytes(bytes: Long): String = when {
    bytes < 0 -> "未知"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> "${bytes / 1024 / 1024} MB"
}

@Composable
private fun ParseResultCard(
    result: MediaParseResult?,
    downloadMessage: String,
    onDownload: (ParsedMedia) -> Unit,
) {
    when (result) {
        is MediaParseResult.Success -> Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(result.media.title, style = MaterialTheme.typography.titleLarge)
                if (result.media.uploader.isNotBlank()) Text("作者：${result.media.uploader}")
                if (result.media.quality.isNotBlank()) Text("清晰度：${result.media.quality}")
                if (result.media.format.isNotBlank()) Text("格式：${result.media.format}")
                if (result.media.sizeBytes > 0) Text("大小：${result.media.sizeBytes / 1024 / 1024} MB")
                Text("解析成功，可下载地址已就绪", color = MaterialTheme.colorScheme.primary)
                Button(
                    onClick = { onDownload(result.media) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("下载到系统 Downloads")
                }
                if (downloadMessage.isNotBlank()) {
                    Text(downloadMessage, color = MaterialTheme.colorScheme.secondary)
                }
            }
        }
        is MediaParseResult.Failure -> {
            val text = when (val failure = result.failure) {
                ParseFailure.LoginRequired -> "需要登录或登录态已过期，请登录平台后重试"
                ParseFailure.CaptureRequired -> "该视频号链接需要第二阶段实时捕获能力"
                ParseFailure.UnsupportedContent -> "当前解析器暂不支持该内容"
                is ParseFailure.RemoteError -> failure.message
            }
            Text(text, color = MaterialTheme.colorScheme.error)
        }
        null -> Text(
            "登录后可解析账号有权访问的媒体。",
            color = MaterialTheme.colorScheme.secondary,
        )
    }
}
