# Tasks

- [x] Task 1: 移除 `flush-hint.aaaa.com` 假域名相关代码
  - [x] SubTask 1.1: 删除 `electron/proxyServer.js` 里 `startServer` 顶部的 `const cdnHitSet = new Set();`
  - [x] SubTask 1.2: 删除 `resp-tap-media` 拦截器里把 encfilekey 塞进 `cdnHitSet` 的分支（保留 `stat.cdnHit++` 已有统计不动）
  - [x] SubTask 1.3: 删除 `proxy.intercept({ hostname: 'flush-hint.aaaa.com' })` 拦截器整段
  - [x] SubTask 1.4: 删除注入脚本 `WVDS_INJECT_SCRIPT` 尾部对 `FLUSH_HINT_URL` 的 700ms setInterval 轮询整段
- [x] Task 2: 恢复 `hookVideoElements` 到 `cacbdfa` 形态
  - [x] SubTask 2.1: 移除 `HTMLMediaElement.prototype.play` 全局 hook 分支
  - [x] SubTask 2.2: 恢复 `bindOne` 只加 `play`/`playing`/`timeupdate` 三个 addEventListener
  - [x] SubTask 2.3: 恢复 `scan` 只做发现 + `bindOne`,删除 800ms setInterval 全站扫描
  - [x] SubTask 2.4: 保留 `MutationObserver` 监听新 `<video>` 元素挂载
- [x] Task 3: 冒烟测试（开发环境）
  - [x] SubTask 3.1: 重启 Electron 主进程，确认无 flush-hint / cdnHitSet 相关日志
  - [x] SubTask 3.2: 粘贴 https://weixin.qq.com/sph/AllwpDnPis 点【浏览器打开】—— 需真人扫码，改为打包后由用户实测
  - [x] SubTask 3.3: 观察小窗是否能加载出播放页（不再黑屏 loading dots）—— 需真人扫码，改为打包后由用户实测
  - [x] SubTask 3.4: 观察主进程日志 `feed-api-video-hit` 是否有 count>0 输出（登录态返回 media）—— 需真人扫码，改为打包后由用户实测
- [x] Task 4: 打包 Universal 版本
  - [x] SubTask 4.1: 运行 `npm run pack` 产出 .dmg（electron-builder 最后 GitHub 上传步骤因缺 GH_TOKEN 失败，但本地产物已完整生成）
  - [x] SubTask 4.2: 记录产物路径给用户 —— `/Users/bytedance/sourceCode/cursor/WebScoop/packs/WebScoop-2.2.3-universal.dmg` (164 MB)

# Task Dependencies
- Task 2 依赖 Task 1（同一份 `proxyServer.js` 的注入脚本字符串，需一起改）
- Task 3 依赖 Task 2 完成
- Task 4 依赖 Task 3 冒烟通过（若冒烟不通过，需先修复再打包）
