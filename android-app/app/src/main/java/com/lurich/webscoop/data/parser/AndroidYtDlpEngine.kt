package com.lurich.webscoop.data.parser

import android.content.Context
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AndroidYtDlpEngine(context: Context) : YtDlpEngine {
    private val applicationContext = context.applicationContext
    private val initializationMutex = Mutex()
    private val preferences = applicationContext.getSharedPreferences(
        "yt_dlp_runtime",
        Context.MODE_PRIVATE,
    )

    @Volatile
    private var initialized = false

    init {
        cleanupCookieFiles(removeAll = true)
    }

    fun warmUp() {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching { ensureInitialized() }
        }
    }

    override suspend fun getInfo(command: YtDlpCommand): YtDlpVideo = withContext(Dispatchers.IO) {
        ensureInitialized()
        val resolvedUrl = resolveDouyinShortUrl(command.url)
        val request = YoutubeDLRequest(resolvedUrl)
        command.options.forEach { (name, value) ->
            if (value == null) request.addOption(name) else request.addOption(name, value)
        }
        val cookieFile = createCookieFile(command)
        if (cookieFile != null) request.addOption("--cookies", cookieFile.absolutePath)
        val info = try {
            YoutubeDL.getInstance().getInfo(request)
        } finally {
            cookieFile?.delete()
        }

        YtDlpVideo(
            mediaUrl = info.url.orEmpty(),
            title = info.title.orEmpty(),
            uploader = info.uploader.orEmpty(),
            format = info.format.orEmpty(),
            resolution = info.resolution.orEmpty(),
            extension = info.ext.orEmpty(),
            sizeBytes = maxOf(info.fileSize, info.fileSizeApproximate),
            webpageUrl = info.webpageUrl.orEmpty(),
        )
    }

    private fun resolveDouyinShortUrl(url: String): String {
        val source = runCatching { URI(url) }.getOrNull() ?: return url
        if (!isAllowedDouyinUri(source) || !source.host.equals("v.douyin.com", ignoreCase = true)) {
            return url
        }
        return runCatching {
            var current = source
            repeat(MAX_REDIRECTS) {
                val connection = URL(current.toString()).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                connection.connectTimeout = URL_RESOLVE_TIMEOUT_MILLIS
                connection.readTimeout = URL_RESOLVE_TIMEOUT_MILLIS
                connection.setRequestProperty("User-Agent", MOBILE_USER_AGENT)
                try {
                    val status = connection.responseCode
                    if (status !in 300..399) return@runCatching current.toString()
                    val location = connection.getHeaderField("Location")
                        ?.takeIf(String::isNotBlank)
                        ?: return@runCatching current.toString()
                    val next = current.resolve(location)
                    if (!isAllowedDouyinUri(next)) {
                        return@runCatching url
                    }
                    current = next
                } finally {
                    connection.disconnect()
                }
            }
            current.toString()
        }.getOrDefault(url)
    }

    private fun isAllowedDouyinUri(uri: URI): Boolean {
        if (!uri.scheme.equals("https", ignoreCase = true)) return false
        val host = uri.host?.lowercase()?.trimEnd('.') ?: return false
        return DOUYIN_REDIRECT_HOSTS.any { allowedHost ->
            host == allowedHost || host.endsWith(".$allowedHost")
        }
    }

    private fun createCookieFile(command: YtDlpCommand): File? {
        if (command.cookieHeader.isBlank() || command.cookieDomain.isBlank()) return null
        val domain = command.cookieDomain
            .trim()
            .trimStart('.')
            .trimEnd('.')
            .lowercase()
            .takeIf { it.matches(COOKIE_DOMAIN_PATTERN) }
            ?: return null
        cleanupCookieFiles(removeAll = false)
        val cookies = command.cookieHeader
            .split(';')
            .mapNotNull { entry ->
                val separator = entry.indexOf('=')
                if (separator <= 0) return@mapNotNull null
                val name = entry.substring(0, separator).trim()
                val value = entry.substring(separator + 1).trim()
                if (name.isBlank()) null else "$domain\tFALSE\t/\tTRUE\t0\t$name\t$value"
            }
        if (cookies.isEmpty()) return null
        val cookieFile = File.createTempFile(
            COOKIE_FILE_PREFIX,
            COOKIE_FILE_SUFFIX,
            applicationContext.cacheDir,
        )
        return try {
            cookieFile.setReadable(false, false)
            cookieFile.setWritable(false, false)
            cookieFile.setReadable(true, true)
            cookieFile.setWritable(true, true)
            cookieFile.apply {
                writeText(
                    buildString {
                        appendLine("# Netscape HTTP Cookie File")
                        cookies.forEach(::appendLine)
                    },
                )
            }
        } catch (error: Exception) {
            cookieFile.delete()
            throw error
        }
    }

    private fun cleanupCookieFiles(removeAll: Boolean) {
        val cutoff = System.currentTimeMillis() - COOKIE_FILE_MAX_AGE_MILLIS
        applicationContext.cacheDir.listFiles()
            .orEmpty()
            .filter { file ->
                file.name.startsWith(COOKIE_FILE_PREFIX) &&
                    file.name.endsWith(COOKIE_FILE_SUFFIX) &&
                    (removeAll || file.lastModified() < cutoff)
            }
            .forEach(File::delete)
    }

    private suspend fun ensureInitialized() {
        if (initialized) return
        initializationMutex.withLock {
            if (!initialized) {
                withContext(Dispatchers.IO) {
                    YoutubeDL.getInstance().init(applicationContext)
                    updateIfStale()
                }
                initialized = true
            }
        }
    }

    private fun updateIfStale() {
        val now = System.currentTimeMillis()
        val lastUpdate = preferences.getLong(LAST_UPDATE_KEY, 0)
        if (now - lastUpdate < UPDATE_INTERVAL_MILLIS) return

        runCatching {
            YoutubeDL.getInstance().updateYoutubeDL(
                applicationContext,
                YoutubeDL.UpdateChannel.STABLE,
            )
        }.onSuccess {
            preferences.edit().putLong(LAST_UPDATE_KEY, now).apply()
        }
    }

    private companion object {
        const val LAST_UPDATE_KEY = "last_successful_update"
        const val UPDATE_INTERVAL_MILLIS = 24 * 60 * 60 * 1000L
        const val URL_RESOLVE_TIMEOUT_MILLIS = 10_000
        const val MAX_REDIRECTS = 5
        const val COOKIE_FILE_PREFIX = "webscoop-cookies-"
        const val COOKIE_FILE_SUFFIX = ".txt"
        const val COOKIE_FILE_MAX_AGE_MILLIS = 60 * 60 * 1000L
        const val MOBILE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Mobile Safari/537.36"
        val DOUYIN_REDIRECT_HOSTS = setOf("douyin.com", "iesdouyin.com")
        val COOKIE_DOMAIN_PATTERN = Regex("""^[a-z0-9.-]+$""")
    }
}
