# QQ 音乐登录入口设计

## 问题

QQ 音乐完整音频依赖登录 Cookie，但当前登录入口隐藏在“打开链接”按钮中，且必须先粘贴
QQ 音乐 URL 才能触发。用户无法直观发现登录方式。

更严重的是，QQ 音乐网页登录通过 `window.open` 打开 QQ/微信授权页面时，当前主进程会
调用 `shell.openExternal` 把页面转给系统浏览器。系统浏览器的 Cookie 不属于 Electron
`defaultSession`，因此用户即使完成登录，WebScoop 解析器仍然是匿名状态。

## 方案

工具栏增加常驻“登录QQ音乐”按钮，点击后固定打开 `https://y.qq.com/`。登录窗口复用
现有单例和 `session.defaultSession`，重复点击只加载首页、显示并聚焦窗口。

QQ 音乐窗口创建的登录子窗口允许在 Electron 内打开，但必须满足：

- URL 协议为 HTTP(S)。
- Host 属于 `qq.com`、`qqmusic.qq.com`、`weixin.qq.com` 或其子域。
- 继承 `session.defaultSession`。
- `nodeIntegration: false`。
- `contextIsolation: true`。
- `sandbox: true`。
- `webSecurity: true`。

不满足条件的弹窗直接拒绝，不再转交系统浏览器。主窗口和其他平台的外链策略保持不变。

## 用户流程

1. 点击工具栏“登录QQ音乐”。
2. 在 QQ 音乐首页右上角选择 QQ 或微信登录。
3. 在内置授权子窗口完成扫码或确认。
4. 回到 WebScoop，粘贴歌曲分享链接并点击“解析下载”。
5. 解析器读取共享 Cookie，按 FLAC、320K MP3 等顺序选择账号可访问的最高完整音质。

## 验证

- 纯函数测试 QQ 音乐初始 URL 和登录弹窗域名白名单。
- preload IPC 白名单包含 `invoke_打开QQ音乐`。
- Electron 构建确认安全窗口参数合法。
- 全量测试、lint、格式检查和 macOS Universal 打包。
