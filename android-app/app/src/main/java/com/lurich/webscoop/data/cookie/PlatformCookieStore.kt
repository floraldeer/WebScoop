package com.lurich.webscoop.data.cookie

import android.webkit.CookieManager
import android.webkit.WebStorage
import com.lurich.webscoop.domain.link.SupportedLink

fun interface PlatformCookieStore {
    fun getCookieHeader(link: SupportedLink): String
}

class WebViewCookieStore(
    private val cookieManager: CookieManager = CookieManager.getInstance(),
) : PlatformCookieStore {
    init {
        cookieManager.setAcceptCookie(true)
    }

    override fun getCookieHeader(link: SupportedLink): String {
        return cookieManager.getCookie(link.platform.loginUrl.toString()).orEmpty()
    }

    fun flush() {
        cookieManager.flush()
    }

    fun clearAll(onComplete: (Boolean) -> Unit = {}) {
        cookieManager.removeAllCookies(onComplete)
        WebStorage.getInstance().deleteAllData()
    }
}
