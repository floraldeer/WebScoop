# QQ 音乐下载设计

## 问题

QQ 音乐链接已经能从 `songid` 解析出歌曲信息，但当前代码调用旧的
`vkey.GetVkeyServer/CgiGetVkey` 接口。对于示例歌曲《爱情买卖》，该接口返回
`result=104003` 和空 `purl`，前端因此直接显示“解析失败”。这混淆了链接识别、
歌曲信息解析和音源授权三个不同阶段。

## 方案

QQ 音乐解析改用当前的 `music.vkey.GetVkey/UrlGetVkey` 接口。解析器先通过
`fcg_play_single_song.fcg` 获取歌曲 MID、媒体 MID、标题、歌手和文件大小，再按以下
顺序获取音源：

1. 使用 `C400{media_mid}.m4a` 请求标准完整音频。
2. 请求携带 Electron 会话中的 `uin`、`qqmusic_uin`、`qm_keyst` 和
   `qqmusic_key` Cookie；账号有相应权限时返回完整音频。
3. 完整音频返回 `104003` 时，使用 `RS02{media_mid}.mp3` 请求 QQ 音乐官方试听音频。
4. 试听成功后返回正常可下载记录，但标题增加 `【试听】`，并携带
   `isPreview: true`，前端显示明确 warning，不再报“解析失败”。
5. 完整音频和试听音频都不可用时，才返回真正的解析错误。

## 登录态

QQ 音乐的完整音频需要有效登录凭证。现有“打开链接”使用系统浏览器，Cookie 无法被
Electron 解析器读取。QQ 音乐链接改为在独立的 Electron `BrowserWindow` 中打开：

- 复用 `session.defaultSession`，使登录 Cookie 与解析器共享并持久保存。
- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- 禁止非 HTTP(S) 导航，并将新窗口链接交给系统浏览器。
- 关闭登录窗口不影响主窗口和下载队列。

用户登录后重新点击“解析下载”，解析器优先返回完整歌曲。未登录时仍可下载官方试听。

## 数据流与边界

解析结果新增 `isPreview` 字段，沿 `App.jsx -> fsm.js -> CaptureTable.jsx` 保存到捕获
记录。已有 `extension` 字段继续决定 `.m4a` 或 `.mp3` 保存后缀。QQ 音乐登录窗口由
独立 IPC 通道打开，不修改代理服务、视频号捕获协调器、解密逻辑或下载队列并发模型。

## 验证

- 单测覆盖新 vkey 请求参数和完整音频结果。
- 单测覆盖 `104003` 自动回退 `RS02` 试听。
- 单测覆盖试听标题、`isPreview` 和 `.mp3` 后缀。
- 回归全部 62 个现有测试、ESLint、Prettier 和 Electron 构建。
- 重新生成 macOS Universal DMG，手工验证匿名试听和登录后重试路径。
