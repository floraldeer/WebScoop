package com.lurich.webscoop

import android.app.Application
import com.lurich.webscoop.data.cookie.WebViewCookieStore
import com.lurich.webscoop.data.download.SystemMediaDownloader
import com.lurich.webscoop.data.parser.AndroidYtDlpEngine
import com.lurich.webscoop.data.parser.ParserRouter
import com.lurich.webscoop.data.parser.YtDlpMediaParser
import com.lurich.webscoop.domain.parser.MediaParseResult
import com.lurich.webscoop.domain.parser.MediaParser
import com.lurich.webscoop.domain.parser.ParseFailure

class WebScoopApplication : Application() {
    lateinit var services: AppServices
        private set

    override fun onCreate() {
        super.onCreate()
        services = AppServices(this)
        services.ytDlpEngine.warmUp()
    }
}

class AppServices(application: Application) {
    val cookieStore = WebViewCookieStore()
    val downloader = SystemMediaDownloader(application, cookieStore)
    val ytDlpEngine = AndroidYtDlpEngine(application)
    private val ytDlpParser = YtDlpMediaParser(ytDlpEngine, cookieStore)

    val parser: MediaParser = ParserRouter(
        ytDlpParser = ytDlpParser,
        qqMusicParser = MediaParser {
            MediaParseResult.Failure(ParseFailure.UnsupportedContent)
        },
        wechatChannelsParser = MediaParser {
            MediaParseResult.Failure(ParseFailure.CaptureRequired)
        },
    )
}
