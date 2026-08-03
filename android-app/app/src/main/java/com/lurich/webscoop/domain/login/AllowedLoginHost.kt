package com.lurich.webscoop.domain.login

import com.lurich.webscoop.domain.model.Platform
import java.net.URI

object AllowedLoginHost {
    private val additionalHosts = mapOf(
        Platform.QQ_MUSIC to setOf("qq.com", "weixin.qq.com"),
        Platform.WECHAT_CHANNELS to setOf("qq.com"),
        Platform.YOUTUBE to setOf("google.com", "accounts.google.com"),
        Platform.INSTAGRAM to setOf("facebook.com"),
        Platform.FACEBOOK to setOf("meta.com"),
        Platform.X to setOf("twitter.com"),
    )

    fun accepts(platform: Platform, uri: URI): Boolean {
        if (uri.scheme?.lowercase() != "https") return false
        val host = uri.host?.lowercase()?.trimEnd('.') ?: return false
        val allowedHosts = platform.hosts + additionalHosts.getOrDefault(platform, emptySet())
        return allowedHosts.any { allowedHost ->
            host == allowedHost || host.endsWith(".$allowedHost")
        }
    }

    fun shouldWarnBlockedNavigation(uri: URI, isForMainFrame: Boolean): Boolean {
        return isForMainFrame && uri.scheme.equals("https", ignoreCase = true)
    }
}
