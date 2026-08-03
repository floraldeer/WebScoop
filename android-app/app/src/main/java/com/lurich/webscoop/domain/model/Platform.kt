package com.lurich.webscoop.domain.model

import java.net.URI

enum class Platform(
    val displayName: String,
    internal val hosts: Set<String>,
    val loginUrl: URI,
) {
    WECHAT_CHANNELS(
        displayName = "视频号",
        hosts = setOf("weixin.qq.com", "finder.video.qq.com"),
        loginUrl = URI("https://channels.weixin.qq.com/"),
    ),
    DOUYIN(
        displayName = "抖音",
        hosts = setOf("douyin.com", "iesdouyin.com"),
        loginUrl = URI("https://www.douyin.com/"),
    ),
    XIAOHONGSHU(
        displayName = "小红书",
        hosts = setOf("xiaohongshu.com", "xhslink.com"),
        loginUrl = URI("https://www.xiaohongshu.com/"),
    ),
    KUAISHOU(
        displayName = "快手",
        hosts = setOf("kuaishou.com", "gifshow.com"),
        loginUrl = URI("https://www.kuaishou.com/"),
    ),
    BILIBILI(
        displayName = "B站",
        hosts = setOf("bilibili.com", "b23.tv"),
        loginUrl = URI("https://www.bilibili.com/"),
    ),
    YOUTUBE(
        displayName = "YouTube",
        hosts = setOf("youtube.com", "youtu.be"),
        loginUrl = URI("https://www.youtube.com/"),
    ),
    X(
        displayName = "X",
        hosts = setOf("x.com", "twitter.com"),
        loginUrl = URI("https://x.com/"),
    ),
    TIKTOK(
        displayName = "TikTok",
        hosts = setOf("tiktok.com"),
        loginUrl = URI("https://www.tiktok.com/"),
    ),
    INSTAGRAM(
        displayName = "Instagram",
        hosts = setOf("instagram.com"),
        loginUrl = URI("https://www.instagram.com/"),
    ),
    FACEBOOK(
        displayName = "Facebook",
        hosts = setOf("facebook.com", "fb.watch"),
        loginUrl = URI("https://www.facebook.com/"),
    ),
    VIMEO(
        displayName = "Vimeo",
        hosts = setOf("vimeo.com"),
        loginUrl = URI("https://vimeo.com/"),
    ),
    WEIBO(
        displayName = "微博",
        hosts = setOf("weibo.com", "weibo.cn"),
        loginUrl = URI("https://weibo.com/"),
    ),
    QQ_MUSIC(
        displayName = "QQ音乐",
        hosts = setOf("y.qq.com", "qqmusic.qq.com"),
        loginUrl = URI("https://y.qq.com/"),
    ),
}
