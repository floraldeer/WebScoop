# 回滚视频号捕获的过度补丁 Spec

## Why
上一版为了应对"播放器把 `<video>` 藏在 shadow DOM / MediaSource 里，导致 addEventListener('play') 不触发"这个假设，往主进程和注入脚本里加了两层补丁：
1. **虚构域名 `flush-hint.aaaa.com`**：主进程 hoxy 用它做 GET 端点，浏览器脚本每 700ms 轮询取 `cdnHitSet`。这个假 hostname 会污染网络面板、被安全软件质疑、且和腾讯真实域名混淆。
2. **视频事件三通路 hook**：在 `HTMLMediaElement.prototype.play` 上打全局补丁 + `setInterval` 每 800ms 扫全站 `<video>`。反而把 `cacbdfa` 里那套"只监听 play/playing/timeupdate>0.1s 事件、由 `pendingByKey` 兜底"的稳定策略破坏了。

用户实测："之前至少是能用的，让你优化下，优化坏了。"，且合理质疑：`flush-hint.aaaa.com` 是哪里来的域名？

## What Changes
- **BREAKING**（对当前 uncommitted diff 而言）：移除 `flush-hint.aaaa.com` 假域名相关的所有代码路径（主进程拦截器 + 注入脚本轮询 + `cdnHitSet` + `stat.cdnHit` 相关 patch）。
- **BREAKING**（对 uncommitted diff）：`hookVideoElements` 恢复到 `cacbdfa` 版本的形态（只监听 `play`/`playing`/`timeupdate>0.1s` 事件 + `MutationObserver` 绑新 `<video>`）。移除 `HTMLMediaElement.prototype.play` 全局 hook 和 800ms 轮询。
- 保留：`isLoggedIn` 严格判定（wxuin!=0）、`forceLogin` 参数、`parseWechatShortLink` 带 cookieHeader、IPC 层 `invoke_打开视频号登录`、`dns.setDefaultResultOrder('ipv4first')`、ECONNRESET/EPIPE 降级。这些是**真修 Bug** 的改动，与"用户看不到视频"的当前回归无关。
- 打包 Universal 版本给用户测试。

## Impact
- Affected specs: 视频号捕获（视频号短链解析 + 内嵌浏览器 + 注入脚本挖 media）
- Affected code:
  - `electron/proxyServer.js`（移除 flush-hint 端点、cdnHitSet、注入脚本里的 700ms 轮询、`HTMLMediaElement.prototype.play` hook、800ms 全站扫）
  - `electron/wechatBrowser.js`（不改动）
  - `electron/wechatFinder.js`（不改动）
  - `electron/ipc.js`（不改动）
  - `electron/index.js`（不改动）
  - `src/App.jsx`（不改动）
  - 打包脚本 `npm run build`

## MODIFIED Requirements

### Requirement: 视频真播放才推送到 UI
系统 SHALL 在用户实际播放某条视频（`<video>` 元素触发 `play` / `playing` / `timeupdate > 0.1s`）时才把候选池 `pendingByKey` 中匹配的 encfilekey 视频推送到主进程。

#### Scenario: 用户在个人主页 hover 出预览
- **WHEN** 页面加载后 finderH5ExtTransfer 返回整页 media，注入脚本仅 stash 入候选池
- **THEN** 主窗口不出现任何卡片，直到某条视频真正触发 `play` 事件

#### Scenario: 用户点击某条视频真播放
- **WHEN** `<video>` 触发 `play` 事件，`currentSrc` 里的 encfilekey 命中候选池
- **THEN** 主窗口出现该条视频的下载卡片（带 decode_key）

## REMOVED Requirements

### Requirement: 主进程通过虚构域名回推 CDN 命中
**Reason**: 引入 `flush-hint.aaaa.com` 是"错误诊断驱动的补丁"——真正的问题不是 DOM 层 hook 失效，而是 uncommitted 改动破坏了 `cacbdfa` 里已经能用的事件监听形态。用假域名回推是"补丁的补丁"。
**Migration**: 完全移除 `cdnHitSet`、`flush-hint.aaaa.com` 拦截器、注入脚本里的 700ms 轮询。回到 `cacbdfa` 的纯"事件驱动 flush" 模式。

### Requirement: 全局 hook `HTMLMediaElement.prototype.play`
**Reason**: 全局改 prototype 副作用大（会被 CSP/沙箱环境警告、影响页面自身错误处理），且和 `cacbdfa` 版本的稳定行为不兼容。
**Migration**: 只保留 `addEventListener('play'/'playing'/'timeupdate')` + `MutationObserver` 绑定新 `<video>` 的做法。
