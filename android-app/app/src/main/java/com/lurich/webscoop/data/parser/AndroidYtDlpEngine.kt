package com.lurich.webscoop.data.parser

import android.content.Context
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
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

    fun warmUp() {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching { ensureInitialized() }
        }
    }

    override suspend fun getInfo(command: YtDlpCommand): YtDlpVideo = withContext(Dispatchers.IO) {
        ensureInitialized()
        val request = YoutubeDLRequest(command.url)
        command.options.forEach { (name, value) ->
            if (value == null) request.addOption(name) else request.addOption(name, value)
        }
        val info = YoutubeDL.getInstance().getInfo(request)

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
    }
}
