# Android 全平台下载器 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WebScoop 仓库中新增可独立构建的 Android 应用，首阶段提供全平台分享链接识别、登录、解析和持久化后台下载。

**Architecture:** 使用 Kotlin 和 Jetpack Compose 构建单 Activity 应用，领域层与 Android UI、yt-dlp 和存储实现解耦。Room 保存任务，WorkManager 执行解析与下载，WebView 保存平台登录 Cookie；视频号 VPN 捕获留在隔离的第二阶段。

**Tech Stack:** Kotlin、Jetpack Compose、Hilt、Room、WorkManager、OkHttp、Android WebKit、Media3、youtubedl-android、JUnit、MockWebServer

---

### Task 1: Android 工程骨架

**Files:**
- Create: `android-app/settings.gradle.kts`
- Create: `android-app/build.gradle.kts`
- Create: `android-app/gradle/libs.versions.toml`
- Create: `android-app/app/build.gradle.kts`
- Create: `android-app/app/src/main/AndroidManifest.xml`
- Modify: `.gitignore`

**Step 1: 创建版本目录和根构建脚本**

声明 Android application、Kotlin、KSP、Hilt、Compose、Room、WorkManager、OkHttp、
Media3、youtubedl-android 和测试依赖，设置 `minSdk = 26`。

**Step 2: 创建应用清单**

只申请网络、通知和前台服务所需权限；注册支持 `text/plain` 的 `ACTION_SEND` 入口。

**Step 3: 生成 Gradle Wrapper**

Run: `gradle wrapper --gradle-version <兼容 AGP 的版本>`
Expected: `android-app/gradlew --version` 成功。

**Step 4: 验证工程配置**

Run: `cd android-app && ./gradlew tasks`
Expected: 输出 Android build、test 和 lint 任务。

### Task 2: 平台识别与链接提取

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/domain/model/Platform.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/domain/link/SharedLinkParser.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/domain/link/SharedLinkParserTest.kt`

**Step 1: 编写失败测试**

覆盖 13 个支持平台、分享文案中的 URL、大小写 Host、恶意后缀域名、非 HTTP(S) 和未知
平台。

**Step 2: 运行测试确认失败**

Run: `cd android-app && ./gradlew testDebugUnitTest --tests '*SharedLinkParserTest'`
Expected: FAIL，领域类型尚不存在。

**Step 3: 实现最小平台注册表**

使用 `java.net.URI` 解析 URL，并以 Host 等值或子域匹配识别平台；不使用包含式字符串匹配。

**Step 4: 运行测试确认通过**

Run: `cd android-app && ./gradlew testDebugUnitTest --tests '*SharedLinkParserTest'`
Expected: PASS。

### Task 3: 下载任务领域模型和 Room

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/domain/model/DownloadTask.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/db/DownloadTaskEntity.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/db/DownloadTaskDao.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/db/WebScoopDatabase.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/domain/model/DownloadTaskTest.kt`

**Step 1: 测试合法状态转换**

验证 `PENDING -> RESOLVING -> READY -> DOWNLOADING -> COMPLETED`，以及失败、取消和重试。

**Step 2: 实现不可变领域模型**

任务外部标识统一命名为 `publicID`，数据库自增主键不暴露到 UI。

**Step 3: 实现 Room 实体与 DAO**

提供按更新时间观察、按 `publicID` 查询、原子更新状态和进度的方法。

**Step 4: 运行领域测试**

Run: `cd android-app && ./gradlew testDebugUnitTest`
Expected: PASS。

### Task 4: Compose 主界面和分享入口

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/MainActivity.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/presentation/home/HomeScreen.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/presentation/home/HomeViewModel.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/presentation/theme/Theme.kt`

**Step 1: 实现 `ACTION_SEND` 文本接收**

Activity 将分享文本交给 ViewModel，不直接解析业务数据。

**Step 2: 实现核心工作区**

页面包含链接输入、平台识别提示、解析下载按钮和任务列表；登录与设置使用 Modal。

**Step 3: 增加 Compose UI 测试**

验证有效链接启用按钮、未知平台提示错误、分享文本自动填充。

**Step 4: 运行 UI 测试**

Run: `cd android-app && ./gradlew connectedDebugAndroidTest`
Expected: 模拟器上 PASS。

### Task 5: yt-dlp 解析适配器

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/domain/parser/MediaParser.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/parser/YtDlpMediaParser.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/parser/ParserRouter.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/data/parser/ParserRouterTest.kt`

**Step 1: 定义结构化解析契约**

返回标题、作者、格式、音质、大小、媒体 URL、Referer 和是否试听；异常使用密封错误类型。

**Step 2: 实现平台路由**

QQ 音乐走专用解析器，视频号走分享链接解析器，其余平台走 yt-dlp。

**Step 3: 接入 youtubedl-android**

只使用结构化 JSON 输出，不解析人类可读日志；敏感参数进入临时受限文件。

**Step 4: 运行适配器测试**

Run: `cd android-app && ./gradlew testDebugUnitTest --tests '*ParserRouterTest'`
Expected: PASS。

### Task 6: 平台 WebView 登录

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/presentation/login/LoginScreen.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/cookie/PlatformCookieStore.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/cookie/WebViewCookieStore.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/data/cookie/AllowedLoginHostTest.kt`

**Step 1: 测试登录域名白名单**

每个平台只允许其主站和必要登录域；拒绝 HTTP、文件 URL 和相似恶意域。

**Step 2: 配置安全 WebView**

禁用文件与内容访问、混合内容和调试；外部未知链接交给系统浏览器。

**Step 3: 同步 Cookie**

通过系统 `CookieManager` 读取目标域 Cookie，禁止日志输出 Cookie。

**Step 4: 运行单元测试和 lint**

Run: `cd android-app && ./gradlew testDebugUnitTest lintDebug`
Expected: PASS。

### Task 7: WorkManager 下载链路

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/worker/DownloadWorker.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/download/MediaDownloader.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/download/MediaStoreDownloader.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/data/download/MediaDownloaderTest.kt`

**Step 1: 使用 MockWebServer 测试下载**

覆盖成功、Range 续传、重定向协议拒绝、磁盘错误、取消和敏感日志过滤。

**Step 2: 实现 MediaStore 写入**

使用 `IS_PENDING` 保证未完成文件不可见，成功后发布，失败后删除残留记录。

**Step 3: 实现唯一后台任务**

以 `publicID` 创建唯一 WorkManager 任务，设置网络约束、指数退避和前台通知。

**Step 4: 运行测试**

Run: `cd android-app && ./gradlew testDebugUnitTest`
Expected: PASS。

### Task 8: QQ 音乐专用解析器

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/parser/QqMusicParser.kt`
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/parser/QqMusicModels.kt`
- Test: `android-app/app/src/test/java/com/lurich/webscoop/data/parser/QqMusicParserTest.kt`

**Step 1: 移植桌面测试向量**

覆盖 songid/songmid、Cookie 派生参数、音质候选排序、无权限降级和试听回退。

**Step 2: 使用 kotlinx.serialization 建模响应**

不使用正则处理 JSON；所有请求通过 OkHttp，设置受控超时。

**Step 3: 验证权限边界**

只选择接口返回 `result = 0` 且 `purl` 非空的候选。

**Step 4: 运行测试**

Run: `cd android-app && ./gradlew testDebugUnitTest --tests '*QqMusicParserTest'`
Expected: PASS。

### Task 9: 第一阶段验收

**Files:**
- Modify: `README.md`
- Create: `android-app/README.md`

**Step 1: 运行 Android 质量门禁**

Run: `cd android-app && ./gradlew testDebugUnitTest lintDebug assembleDebug`
Expected: BUILD SUCCESSFUL，并生成 debug APK。

**Step 2: 运行桌面回归**

Run: `npm test -- --runInBand && npm run lint && npm run format:check`
Expected: 全部通过，视频号桌面路径无回归。

**Step 3: 真机冒烟**

验证分享入口、至少一个公开视频平台、QQ 音乐匿名试听、QQ 音乐登录完整音频、后台下载、
取消、重试、打开和分享。

**Step 4: 记录第二阶段入口**

只建立 `capture` 包和 ADR，不申请 VPN 权限，不在第一阶段启动本地 VPN。
