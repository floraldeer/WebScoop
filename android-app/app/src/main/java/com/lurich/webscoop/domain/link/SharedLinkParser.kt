package com.lurich.webscoop.domain.link

import com.lurich.webscoop.domain.model.Platform
import java.net.URI

data class SupportedLink(
    val url: URI,
    val platform: Platform,
)

sealed interface LinkParseResult {
    data class Supported(val link: SupportedLink) : LinkParseResult

    data class Unsupported(val reason: String) : LinkParseResult
}

object SharedLinkParser {
    private val webUrlPattern = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val trailingPunctuation = charArrayOf('.', ',', ';', ':', '!', '?', ')', ']', '}', '，', '。')

    fun parse(input: String): LinkParseResult {
        val candidate = webUrlPattern.find(input.trim())?.value?.trimEnd(*trailingPunctuation)
            ?: return LinkParseResult.Unsupported("未找到 HTTP(S) 链接")
        val uri = runCatching { URI(candidate).normalize() }.getOrNull()
            ?: return LinkParseResult.Unsupported("链接格式无效")
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()?.trimEnd('.')

        if (scheme !in setOf("http", "https") || host.isNullOrBlank()) {
            return LinkParseResult.Unsupported("只支持 HTTP(S) 链接")
        }

        val platform = Platform.entries.firstOrNull { candidatePlatform ->
            candidatePlatform.hosts.any { allowedHost ->
                host == allowedHost || host.endsWith(".$allowedHost")
            }
        } ?: return LinkParseResult.Unsupported("暂不支持该平台")

        return LinkParseResult.Supported(SupportedLink(uri, platform))
    }
}
