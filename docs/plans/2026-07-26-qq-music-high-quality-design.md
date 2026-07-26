# QQ 音乐高质量完整音频设计

## 目标

用户在 WebScoop 的 QQ 音乐窗口登录后，解析分享链接时下载账号有权访问的最高质量完整
音频。未登录或账号无完整音频权限时，继续提供明确标注的官方试听，不绕过会员、付费或
版权限制。

## 音质候选

解析器根据歌曲信息接口返回的文件大小生成候选，按以下顺序排列：

1. `F000{media_mid}.flac`：FLAC 无损。
2. `M800{media_mid}.mp3`：MP3 320K。
3. `M500{media_mid}.mp3`：MP3 128K。
4. `C600{media_mid}.m4a`：AAC 192K。
5. `C400{media_mid}.m4a`：AAC 96K。

文件大小为 `0` 的档位不提交。若歌曲信息缺少所有大小字段，保留 `C400` 作为兼容兜底。
不请求 `.mflac`、`.mgg` 等客户端加密格式，避免引入专有解密逻辑。

## 请求与选择

完整音频候选在一次 `music.vkey.GetVkey/UrlGetVkey` 请求中批量提交，`filename`、
`songmid`、`songtype` 数组保持相同顺序和长度。响应按候选优先级匹配文件名，选择第一
个 `result=0` 且 `purl` 非空的项目。

解析结果增加：

- `quality`：例如 `FLAC 无损`、`MP3 320K`。
- `extension`：按实际文件名返回 `.flac`、`.mp3` 或 `.m4a`。
- `size`：优先使用 Range 响应总长度，失败时使用歌曲信息中的对应大小。
- `isPreview`：完整音频为 `false`，试听为 `true`。

所有完整候选都无权限时，继续请求 `RS02{media_mid}.mp3` 官方试听。

## UI 与下载

`quality` 沿 `App.jsx -> fsm.js -> CaptureTable.jsx` 透传。列表显示独立音质标签，下载
文件名保持歌曲名与歌手，不把音质文本拼入标题。登录后重新解析同一分享链接时，完整音频
替换原试听记录。

现有下载扩展名白名单已包含 FLAC、MP3 和 M4A，无需修改下载器。视频号捕获、代理服务、
解密流程和单线程 FIFO 下载队列均保持不变。

## 验证

- 批量 payload 的候选顺序和数组长度。
- FLAC 成功时选择无损。
- FLAC 无权限、320K 成功时自动降级。
- 所有完整候选无权限时回退试听。
- `quality`、`extension`、`size` 和 UI 标签透传。
- 全量 Jest、ESLint、Prettier、Electron 构建和 macOS Universal DMG。
