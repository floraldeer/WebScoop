# Android 全平台下载器设计

## 目标

新增一个仅供个人使用的 Android 应用，迁移 WebScoop 当前支持平台的分享链接解析、账号
登录、媒体预览和后台下载能力。首阶段支持视频号、抖音、小红书、快手、B站、YouTube、
X、TikTok、Instagram、Facebook、Vimeo、微博和 QQ 音乐的链接入口；不绕过会员、付费
或版权权限。

## 分阶段边界

### 第一阶段：链接解析与下载

- 用户从系统分享面板或应用输入框提交分享链接。
- 应用识别平台，并用专用解析器或 yt-dlp 获取账号有权访问的媒体。
- 需要登录的平台使用应用内 WebView 登录，Cookie 仅保存在应用私有目录。
- 解析结果展示标题、作者、平台、音质、格式和估算大小。
- 下载任务由 WorkManager 持久化，文件写入系统 MediaStore 的 Downloads/WebScoop。
- QQ 音乐按 FLAC、MP3 320K、MP3 128K、AAC 192K、AAC 96K 顺序选择可访问音质，
  无完整音频权限时回退官方试听。

视频号首阶段只尝试分享链接解析。若微信接口未返回可下载地址，明确提示该链接需要第二
阶段的实时捕获能力，不伪报解析成功。

### 第二阶段：视频号实时捕获

- 使用 Android `VpnService` 建立仅本机流量可见的捕获通道。
- 证书、域名匹配、`decode_key` 提取和 XOR 解密放在独立模块。
- 仅在用户主动启用捕获时运行，并显示常驻系统通知。
- 微信证书固定或系统版本导致流量不可解密时，保留分享链接解析路径并给出明确诊断。

第二阶段不修改 Electron 现有视频号代理、目标匹配、解密和下载稳定路径。

## 技术架构

应用使用 Kotlin、Jetpack Compose、Navigation Compose、Hilt、Room、WorkManager、
OkHttp、Android WebKit、Media3 和 `youtubedl-android`。采用单 Activity 与分层架构：

- `presentation`：输入、任务列表、登录、设置和预览页面。
- `domain`：平台识别、解析结果、下载任务和用例接口，不依赖 Android UI。
- `data`：yt-dlp、QQ 音乐专用解析、Cookie、Room 和媒体文件实现。
- `worker`：受系统约束的解析与下载任务。
- `capture`：第二阶段视频号 VPN 捕获，独立于通用下载链路。

首阶段保持单应用模块，只有出现明确的编译隔离或复用需求时才拆分 Gradle 模块。

## 数据流

1. `ACTION_SEND` 或输入框产生原始文本。
2. 链接提取器使用 `Patterns.WEB_URL` 与 `URI` 解析得到规范 URL。
3. 平台注册表按 Host 精确匹配，拒绝非 HTTP(S) 和未知平台。
4. 解析用例选择 QQ 音乐专用解析器或 yt-dlp 适配器。
5. 结果写入 Room；用户确认后创建唯一 WorkManager 下载任务。
6. Worker 使用平台 Cookie 和 Referer 下载，进度写回 Room 并发送系统通知。
7. 文件通过 MediaStore 发布，完成页使用系统 URI 打开或分享。

## 安全与隐私

- 不提供公网服务，不在代码中硬编码用户 Cookie、Token 或代理配置。
- WebView 仅允许受支持平台及其登录域名，禁用文件访问和明文流量。
- Cookie、任务数据库和临时文件位于应用沙箱；日志过滤 Cookie、签名参数和完整下载 URL。
- 下载仅接受解析器返回的 HTTP(S) 地址，并限制重定向协议。
- Android 网络安全配置默认拒绝明文 HTTP；视频号第二阶段所需例外按域名最小化配置。

## 验收标准

- Android 8.0（API 26）及以上可安装运行。
- 分享文本和直接 URL 均能识别所有声明支持的平台。
- 应用重启后解析、排队、下载中和历史任务仍可恢复。
- yt-dlp 失败、登录过期、无权限、存储不足和网络中断均显示可操作错误。
- 下载进入系统 Downloads/WebScoop，可预览、打开和分享。
- QQ 音乐不会返回账号无权访问的完整音频。
- 第一阶段代码不改变现有 Electron 行为，桌面 Jest 回归继续通过。
