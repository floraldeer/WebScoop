# WebScoop 里程碑（可复用参考）

> 记录「已经打通、可长期当作基线」的节点。接手或继续迭代时优先看这里，再下钻到 `IMPLEMENTED.md` / `OPERATIONS.md`。

---

## 里程碑 M1：多平台捕获与下载可用

**状态**：已达成（约 2026-07，`eca51f7` 一带）

**达成内容**：

- 微信视频号：短链元信息 → 唤起桌面微信播放 → 代理捕获 `decode_key` + CDN → XOR 解密下载
- 多平台链接解析：小红书 / 快手 / B 站 / 抖音 / YouTube 等（yt-dlp 或页面解析）
- 下载队列、进度、失败清理半成品等基础体验

**当时缺口**：macOS（尤其 15 Sequoia）上一键初始化经常「证书进了钥匙串但未信任」，代理门禁过不去，首次安装体验差。

---

## 里程碑 M2：macOS 一键安装可用 + 更便捷（当前基线）

**状态**：已达成并实测通过（2026-07-19）

**验收结论（本机实测）**：

| 项 | 结果 |
| --- | --- |
| 一键初始化（macOS 15） | 通过：原生授权框输登录密码即可设信任 |
| 微信视频号 | 可用 |
| 小红书 | 可用 |
| B 站 | 可用 |
| 快手 | 可用 |

**相对 M1 的跃迁**：

1. **安装真正可用**：不再依赖 `sudo-prompt` / osascript 提权写 admin 域信任（会被 Sequoia 拒成「no user interaction possible」）。
2. **更便捷**：主进程直接跑 `security add-trusted-cert -r trustRoot -p ssl <cert>`，写**用户域（login 钥匙串）**信任，系统弹原生授权框，一步完成；失败时有「重试自动信任」+ 钥匙串手动兜底。
3. **已存在未信任证书也能修好**：信任前先删 login 里同名未信任副本，避免「证书已存在」导致信任写不进去。

**关键实现（以后改证书逻辑时对照）**：

| 点 | 做法 | 不要再做 |
| --- | --- | --- |
| 写信任的进程上下文 | Electron 主进程子进程、用户 GUI 会话 | `sudo-prompt` / osascript「with administrator privileges」 |
| 信任域 | 用户域 login（不加 `-d`） | admin 域 + `System.keychain` + 改 `authorizationdb` |
| 成功判据 | `security verify-cert -c ~/.webscoop/cert/public.pem -p ssl` | 只看钥匙串里有没有证书 |
| 手动兜底 | `open -b com.apple.keychainaccess` + 复制完整 CN | `shell.openPath(public.pem)`（会弹多余「添加证书」框） |
| 重试 UI | `needsManualTrustGuide` + `certCommonName` | 仅靠 `matches('需要手动信任')`（重试时会闪回首次页） |

**相关代码 / 文档**：

- 代码：`electron/cert.js`、`electron/ipc.js`、`electron/localCertificate.js`、`src/fsm.js`、`src/components/InitScreen.jsx`
- 运维：`docs/OPERATIONS.md` 第二节（证书信任操作）
- 变更流水：`docs/IMPLEMENTED.md` 2026-07-18 证书相关条目

**等价手动命令（排错）**：

```bash
# 与一键初始化等效（会弹原生授权框）
security add-trusted-cert -r trustRoot -p ssl ~/.webscoop/cert/public.pem

# 应输出 certificate verification successful
security verify-cert -c ~/.webscoop/cert/public.pem -p ssl
```

---

## 后续可记的下一里程碑（尚未达成）

（占位，达成后再填）

- 正式 Developer ID 签名 + 公证（减少 Gatekeeper「无法打开」）
- 自动更新在未签名环境下的体验策略
- Windows 端同等验收清单
