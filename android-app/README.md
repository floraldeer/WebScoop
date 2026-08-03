# WebScoop Android

WebScoop 的 Android 原生客户端。当前处于第一阶段基础实现，目标是支持分享链接解析、平台
登录、持久化后台下载和系统媒体库发布。

## 当前进度

- 已建立 Kotlin、Jetpack Compose 和 Material 3 工程。
- 已支持从 `ACTION_SEND text/plain` 接收分享内容。
- 已实现 13 个平台的严格 Host 识别。
- 已实现下载任务状态机、解析器契约和平台路由。
- 已接入真实 yt-dlp 结构化解析，并每日尝试更新稳定版提取器。
- 已实现安全 WebView 平台登录、授权弹窗和 Cookie 注入。
- 已接入系统 DownloadManager，下载到公共 `Downloads/WebScoop`。
- 已实现持久化下载队列、实时进度、失败状态和取消操作。
- 已实现重复文件确认和系统下载位置入口。
- QQ 音乐专用网络解析尚待接入。
- 视频号 VPN 实时捕获属于第二阶段。

## 构建要求

- JDK 17 或更高版本。
- Android SDK Platform 35。
- Android SDK Build Tools 35。

```bash
cd android-app
./gradlew testDebugUnitTest lintDebug assembleDebug
```

首次运行 Gradle Wrapper 和 Android SDK 依赖需要访问 Gradle、Google Maven 与 Maven
Central。不要提交 `local.properties`、签名文件、Cookie 或 Token。

## 能力边界

应用只下载当前账号和公开接口有权访问的媒体，不绕过会员、付费或版权权限。登录 Cookie
仅保存在 Android 应用沙箱，不写入日志。
