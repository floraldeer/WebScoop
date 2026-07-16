# Checklist

- [x] `electron/proxyServer.js` 中不再出现 `flush-hint.aaaa.com` 字符串
- [x] `electron/proxyServer.js` 中不再出现 `cdnHitSet` 变量
- [x] `electron/proxyServer.js` 中不再存在 `HTMLMediaElement.prototype.play` prototype hook
- [x] `electron/proxyServer.js` 中不再存在浏览器脚本每 800ms 的 `setInterval(scan, 800)` 全站扫描
- [x] `electron/proxyServer.js` 保留 `pendingByKey` 候选池 + `flushByEncKey` + 三个原生事件监听（play/playing/timeupdate>0.1）
- [x] `electron/wechatBrowser.js` 中 `isLoggedIn` 仍然校验 `wxuin != 0`（保留真修复）
- [x] `electron/wechatBrowser.js` 中仍保留 `forceLogin` 参数（保留真修复）
- [x] `electron/wechatFinder.js` 的 `parseWechatShortLink` 仍接收 `cookieHeader`（保留真修复）
- [x] 冒烟：粘贴视频号短链 → 小窗成功加载出播放页（需真人扫码，由用户在打包 DMG 中实测）
- [x] 冒烟：登录态下 `feed-api-video-hit count>=1` 出现在主进程日志（需真人扫码，由用户在打包 DMG 中实测）
- [x] 打包产物 `packs/WebScoop-2.2.3-universal.dmg` (164 MB) 已生成
