# WebScoop 已实现功能与变更记录

> 面向接手者：一眼看清「现在有什么、最近改了什么」。产品定位见 `README.md`，设计过程见 `docs/plans/`。

## 一、产品概述

WebScoop（拾海）是一个基于 Electron + React 的桌面视频抓取/下载工具。核心原理：在本机生成并安装一张根证书（CA），启动本地 MITM 代理（`hoxy`）并把系统 HTTP(S) 代理指向它，从而在网页/桌面微信播放视频时捕获媒体流并下载（微信视频号支持 XOR 解密）。

## 二、技术栈

- 主进程：Electron 26、hoxy（MITM）、axios、youtube-dl-exec（yt-dlp）、electron-log、sudo-prompt、regedit
- 渲染进程：React 18、XState 4（状态机）、Ant Design 4
- 构建：react-app-rewired（渲染）+ webpack（主进程），electron-builder 打包（mac universal DMG / win NSIS）
- 工程化：ESLint 8、Prettier 2、husky 8 + lint-staged、Jest（CRA 自带）、GitHub Actions CI

## 三、模块结构

### 主进程 `electron/`

| 文件 | 职责 |
| --- | --- |
| `index.js` | App 启动、主窗口安全配置（contextIsolation/sandbox）、异常兜底、更新检查 |
| `preload.js` | contextBridge 暴露 `window.webscoop`，IPC 通道白名单 |
| `ipc.js` | 所有 IPC handler 汇总 |
| `const.js` | 路径与常量（证书目录 `~/.webscoop/cert/` 等） |
| `cert.js` | 根证书系统信任的安装/校验（macOS `security` / Windows `certutil`） |
| `localCertificate.js` | 本机独立 CA 生成（每台机器随机 CN，私钥仅存本地） |
| `proxyServer.js` | hoxy MITM 代理：脚本注入、媒体捕获、生命周期与退出清理 |
| `setProxy.js` / `proxyState.js` | 系统代理设置/快照恢复 |
| `scopedTls.js` | 仅对腾讯系域名放宽上游 TLS 校验 |
| `platformParsers.js` | 多平台链接解析（抖音/小红书/快手/B站/YouTube 等） |
| `wechatFinder.js` | 视频号短链元信息与可播放 URL 探测 |
| `wechatCaptureCoordinator.js` | 视频号候选与 CDN 活动配对 |
| `utils.js` | 下载 pipeline、文件名去重、更新检查 |
| `decrypt.js` | 视频号 XOR 解密器（Emscripten 产物） |
| `expiringMap.js` | TTL/容量有界 Map |

### 渲染进程 `src/`

| 文件 | 职责 |
| --- | --- |
| `App.jsx` | 主界面（初始化卡片、链接解析、捕获列表、下载队列） |
| `fsm.js` | XState 状态机：初始化检测 → 代理启动 → 捕获/下载队列 |
| `App.less` | 样式 |

## 四、核心功能

1. **首次初始化**：本机生成 CA 并安装为系统信任根（macOS/Windows）。
2. **本地 MITM 代理**：hoxy + 动态端口 + 系统代理设置/退出恢复。
3. **微信视频号**：短链元信息 → 复制并唤起桌面微信 → 捕获 `decode_key` + CDN 地址 → XOR 解密下载。
4. **多平台解析**：抖音/B站/YouTube/X/TikTok/Instagram/Facebook/Vimeo/微博（yt-dlp），小红书/快手（页面解析）。
5. **被动 CDN 捕获**：网页播放时按内容类型抓取非微信视频流。
6. **下载队列**：进度条、文件名冲突自动 `(n)`、失败清理半成品。
7. **打开下载目录 / 打开已下载文件**（会话内白名单）。
8. **更新检查**。

## 五、测试与工程命令

```bash
npm test            # 跑单元测试（CI 模式）
npm run test:watch  # 交互式测试
npm run lint        # ESLint
npm run lint:fix    # ESLint 自动修复
npm run format:check# Prettier 检查
npm run pretty      # Prettier 写入
npm run build-electron  # 构建主进程
npm run build-all       # 构建主进程 + 渲染
npm run pack:mac / pack:win  # 打包
```

CI：`.github/workflows/ci.yml` 在 macOS + Windows 上跑 `lint → format:check → test → build-electron`。

---

## 六、新增 / 变更点（按时间倒序）

### 2026-07-18 一键证书信任改为交互式用户域授权（修复 macOS 15 装不上信任）

**背景 bug**：一键初始化后证书「没装成功」——证书其实已进钥匙串，但「信任」这步被 macOS 拦下（`此根证书不被信任`）。日志实锤：`SecTrustSettingsSetTrustSettings: The authorization was denied since no user interaction was possible`。根因是旧实现用 `sudo-prompt`（osascript 提权）在**非交互 root 上下文**里执行 `security add-trusted-cert -d`（admin 域 / System.keychain），而 macOS Big Sur+（尤其 15 Sequoia）要求「给根证书设信任」必须有一次**交互式 GUI 授权**，该上下文弹不出授权框，于是证书进了钥匙串、信任没写上，`verify-cert` 恒报 `CSSMERR_TP_NOT_TRUSTED`。此前把 `authorizationdb ... allow` 临时放开的绕过手法在 Sequoia 上已失效（返回 `NO (-60005)`）。

**修复**：

- `electron/cert.js`：macOS 安装路径重写 `installCertDarwin`——不再走 `sudo-prompt`，而是**直接以主进程（处于用户 GUI 会话）的子进程**运行 `security add-trusted-cert -r trustRoot -p ssl <public.pem>`，写入**用户域（login 钥匙串）**信任。因不经提权，macOS 会自动弹出**原生授权框**，输入本机登录密码即可一步设好信任；用户域信任同样被 `security verify-cert`、Chromium、微信 XWeb 认可（均读取 login+System 钥匙串的「始终信任」）。新增纯函数 `classifyTrustOutcome`（导出，可单测）：`trusted` / 取消授权→`failed`（回空闲可重试）/ 其余→`installed_untrusted`（引导手动或重试）。Windows 路径不变。
- `electron/ipc.js`：手动兜底改为打开**「钥匙串访问」应用**（`open -b com.apple.keychainaccess`）而非打开 `.pem`——后者会弹出多余的「添加证书」框且不是设信任的地方；`invoke_打开钥匙串信任引导` 同步改为打开钥匙串访问。
- `src/components/InitScreen.jsx`：初始化文案点明「会弹系统授权框，输入本机登录密码即可」；手动信任引导页把主按钮改为**「重试自动信任」**（再弹一次原生授权框），并保留「我已手动信任，重新检测」「打开钥匙串访问手动信任」。
- `src/fsm.js`：`installed_untrusted` 的提示改为「可点重试自动信任或手动设为始终信任」。
- 测试：新增 `src/__tests__/cert.test.js`（`classifyTrustOutcome` 5 用例）；全量 12 套件 / 57 用例通过。
- 文档：`docs/OPERATIONS.md` 第二节重写为交互式用户域授权流程与排错命令，卸载/FAQ 同步更新。

### 2026-07-18 初始化死循环修复 + 工程化基线

**背景 bug**：2.2.8 版本点「一键初始化」后反复回到初始化界面。根因是 macOS Big Sur+ 的安全加固——通过 `sudo-prompt` 执行 `security add-trusted-cert -d` 时，证书能进 `System.keychain`，但写入 admin 域信任设置需要交互式授权（仅 root 不够），osascript 提权上下文无法弹出该二级授权框，导致信任写入被拒（`SecTrustSettingsSetTrustSettings: The authorization was denied since no user interaction was possible`）。结果证书虽在钥匙串却未受信，`security verify-cert` 恒失败，初始化检测永远为 false；同时前端把安装错误 `.catch(() => {})` 吞掉并强制重检，形成死循环。

**修复（P0）**：

- `electron/cert.js`：
  - `installCert` 返回结构化结果 `{ status: 'trusted' | 'installed_untrusted' | 'failed', ... }`（导出 `CERT_STATUS`）。
  - macOS 安装把「临时放开 admin 信任授权 → 删旧证书 → 写信任 → 收回授权」合并为**一次** sudo 调用，规避二次交互失败；失败后再复核信任状态区分「已装未信任」与「彻底失败」。
  - 用户取消提权时返回明确文案而非静默。
- `electron/ipc.js`：
  - `invoke_开始初始化` 返回结构化结果；`installed_untrusted` 时主进程自动打开证书（触发「钥匙串访问」）并把 CN 复制到剪贴板。
  - 新增 `invoke_打开钥匙串信任引导` 通道。
  - `invoke_启动服务` 增加证书信任门禁：未受信不启动代理，避免污染系统网络。
  - `throw '取消'` 改为 `throw new Error('取消')`；代理失败日志改走 `electron-log`。
- `electron/preload.js`：白名单新增 `invoke_打开钥匙串信任引导`。
- `src/fsm.js`：
  - `invoke_开始初始化` 去掉空 `.catch`，按 `status` 分流：`trusted → 重新检测`；`installed_untrusted → 需要手动信任`；`failed → 提示真实错误`。
  - `invoke_初始化信息` 补 `.catch`，异常时明确落到未初始化，不再卡 loading。
  - 新增子状态 `未初始化.需要手动信任`。
- `src/App.jsx`：新增「设为始终信任」的引导 UI（含「我已信任，重新检测」「重新打开钥匙串访问」按钮），一键初始化按钮加 loading 态。

**重构与死代码清理（P2）**：

- `electron/proxyServer.js`（原 813 行「上帝模块」）拆分：
  - 注入脚本抽到 `electron/inject/wvdsInjectScript.js`。
  - 日志助手抽到 `electron/proxy/logger.js`（`info`/`debug`/`DEBUG_WX`）。
  - 纯函数（平台识别、视频请求判定、URL 拼装、HTML 注入、feed 媒体挖掘）抽到 `electron/proxy/mediaMatchers.js`。
  - `BUILD_TAG` 硬编码改为读 `app.getVersion()`。
- `src/App.jsx`（原 531 行单文件）拆分：常量到 `src/constants.js`；初始化/信任/失败三屏到 `src/components/InitScreen.jsx`；捕获列表到 `src/components/CaptureTable.jsx`。
- 删除死代码：`electron/wechatBrowser.js`（含关闭证书校验 `setCertificateVerifyProc(cb(0))`、`contextIsolation:false` 高危项）、诊断脚本 `wechatDesktopProbe.js` / `xhsProbe.js`，以及死 IPC `invoke_打开视频号浏览器`。
- `webpack.electron.js` 拆成两份配置：`index` 用 `target: electron-main`，`preload` 用 `target: electron-preload`。
- 统一文案：平台解析里过时的「浏览器打开」改为与按钮一致的「打开链接」；`electron/utils.js` 更新 URL 改为 floraldeer 仓库并记录失败日志；README Release 地址更正。

**新增功能（P3）**：

- 自动更新：接入 `electron-updater`（`electron/autoUpdater.js`），生产环境启动时检查、后台下载、下载完成后提示重启安装；`package.json` 配置 GitHub `publish`。移除旧的 jsdelivr 手动检查。
- 下载增强：
  - 失败自动重试（`electron/utils.js`，网络类临时故障最多重试 2 次，指数退避）。
  - 取消下载（`AbortController` + IPC `invoke_取消下载`，UI 下载浮层加「取消」按钮）。
  - 下载历史持久化（`electron/downloadHistory.js` → `~/.webscoop/history.json`，IPC `invoke_下载历史`/`invoke_清空下载历史`）。
- 设置面板（`src/components/SettingsDrawer.jsx`，头部齿轮按钮打开）：
  - 默认下载目录（作为选择框默认路径，`electron/appSettings.js` → `~/.webscoop/settings.json`）。
  - 打开日志目录。
  - 清理证书与缓存并恢复系统代理（`invoke_清理证书与缓存`：停代理→恢复系统代理→删除本机 CA）。
  - 下载历史查看与清空。
- 平台解析健壮性：`resolveYtDlpBinaryPath` 抽为可测纯函数；找不到可用 yt-dlp 时抛清晰提示而非隐晦栈。
- 说明：为尊重隐私，未接入第三方错误上报；日志经 `electron-log` 落盘并限制单文件 20MB。

**新增/变更的 IPC 通道**：`invoke_打开钥匙串信任引导`、`invoke_取消下载`、`invoke_下载历史`、`invoke_清空下载历史`、`invoke_获取设置`、`invoke_更新设置`、`invoke_清理证书与缓存`、`invoke_打开日志目录`；移除 `invoke_打开视频号浏览器`。

**测试**：新增 `mediaMatchers`、`ytDlpResolve`、`appSettings`、`downloadHistory` 单测，共 11 套件 / 52 用例全部通过。

**工程化基线（P1）**：

- `package.json`：新增 `test`/`test:watch`/`lint`/`lint:fix`/`format:check`/`prepare` 脚本；用 `lint-staged` 替换 husky v4 风格且危险的 `git add -A` 钩子。
- 新增 `.eslintrc.js`（渲染用 react-app、主进程用 node 环境分目录规则）、`.prettierrc.json`、`.prettierignore`。
- `.husky/pre-commit` 改为 `npx lint-staged`（仅格式化暂存文件）。
- `.gitignore` 取消忽略 `package-lock.json`，提交 lockfile 保证可复现构建。
- 新增 `.github/workflows/ci.yml`（macOS + Windows）。
- 全量 Prettier 统一代码风格。
- 新增本文件与 `docs/OPERATIONS.md`。
