# WebScoop 运维与安全说明

## 一、安全模型与风险须知（重要）

WebScoop 的工作方式决定了它的权限面非常大，务必让使用者知情：

1. **本机根证书（CA）**：首次初始化会在 `~/.webscoop/cert/` 生成一张**本机专属**根证书（每台机器随机 CN，私钥 `private.pem` 权限 600，仅存本地、不上传），并把它安装为**系统信任根**。
2. **系统级 MITM 代理**：运行时会把系统 HTTP(S) 代理指向本地 hoxy 代理。这意味着运行期间**本机所有 HTTPS 流量都可被该证书解密**。因此：
   - 私钥一旦泄露，攻击者可对该机器做中间人攻击。请勿拷贝 `~/.webscoop/cert/private.pem`。
   - 退出应用后必须确认系统代理已恢复（见下文）。
3. **TLS 校验放宽范围**：`electron/scopedTls.js` 仅对腾讯系域名放宽上游证书校验，用于视频号捕获，范围应保持最小。

## 二、证书信任操作（macOS）

> 里程碑说明与「以后改证书逻辑时不要踩的坑」见 [`docs/MILESTONES.md`](./MILESTONES.md) 的 **M2**。

由于 macOS Big Sur+（尤其 15 Sequoia）的安全策略，**给根证书设「始终信任」必须有一次交互式 GUI 授权**（Apple 官方结论：非 MDM 环境无法后台完成）。关键点：这个授权对话框只有在「标准 GUI 会话」里才能弹出。

**实现方式（新版）**：一键初始化直接以主进程子进程运行
`security add-trusted-cert -r trustRoot -p ssl <public.pem>`，写入**用户域（login 钥匙串）**的信任。因为不经 `sudo`/osascript 提权，macOS 会自动弹出**原生授权框**，输入本机登录密码即可一步设好信任。用户域信任同样被 `security verify-cert`、Chromium、微信 XWeb 认可（它们都会读取 login + System 钥匙串里「始终信任」的设置）。

> 为什么早期版本「一键后证书没装成功」：旧实现用 `sudo-prompt`（osascript 提权）执行 `security add-trusted-cert -d`，属于**非交互 root 上下文**，`SecTrustSettingsSetTrustSettings` 会以 `The authorization was denied since no user interaction was possible` 被拒——证书进了钥匙串但信任没设上，`verify-cert` 恒报 `CSSMERR_TP_NOT_TRUSTED`。注意：此时弹出的「添加证书」框（钥匙串：登录）是打开 `.pem` 触发的多余提示，证书其实已在钥匙串里，点「取消」即可，那里也不是设信任的地方。

正常流程：

1. 点「一键初始化」→ 弹出系统授权框 → 输入本机登录密码「允许」→ 直接进入主界面。
2. 若取消了授权 → 停在初始化页，可再点「一键初始化」重试。
3. 极少数情况下（已授权但仍未验过）→ 界面切到引导页，优先点「重试自动信任」再弹一次授权框；仍不行就手动：
   - 应用已自动打开「钥匙串访问」并把证书名复制到剪贴板，找到 `WebScoop Local CA ...`（可直接粘贴搜索）。
   - 双击该证书 → 展开「信任」 → 「使用此证书时」设为 **始终信任** → 关闭窗口输入密码。
   - 回到 WebScoop 点「我已手动信任，重新检测」。

### 手动核对信任状态（排错用）

```bash
# 证书是否在钥匙串（login 或 System 均可）
security find-certificate -c "WebScoop Local CA" ~/Library/Keychains/login.keychain-db

# 系统是否信任（成功输出 "certificate verification successful"；失败输出 CSSMERR_TP_NOT_TRUSTED）
security verify-cert -c ~/.webscoop/cert/public.pem -p ssl

# 手动等价命令（与一键初始化等效，会弹原生授权框）
security add-trusted-cert -r trustRoot -p ssl ~/.webscoop/cert/public.pem
```

## 三、证书信任操作（Windows）

Windows 用 `certutil -addstore -f Root` 安装，无 macOS 的交互限制，一次提权即可完成。

## 四、卸载 / 清理

彻底移除 WebScoop 时建议按序清理：

1. **恢复系统代理**：正常退出应用会自动恢复（快照存于 `~/.webscoop/proxy-state.json`）。若异常退出导致上网异常，可手动关闭系统代理：
   - macOS：系统设置 → 网络 → 对应网络 → 详细信息 → 代理，关闭「网页代理/安全网页代理」。
   - Windows：设置 → 网络和 Internet → 代理，关闭「使用代理服务器」。
2. **移除根证书**：
   - macOS（新版信任写在 login 钥匙串，无需 sudo）：`security delete-certificate -c "WebScoop Local CA <你的CN后缀>" ~/Library/Keychains/login.keychain-db`。若历史版本还往系统钥匙串装过，再加一条：`sudo security delete-certificate -c "WebScoop Local CA <你的CN后缀>" /Library/Keychains/System.keychain`（或直接在「钥匙串访问」里删除）。
   - Windows：`certutil -delstore Root "WebScoop Local CA <你的CN后缀>"`。
3. **删除本地数据**：删除 `~/.webscoop/` 目录（含证书、代理快照、下载历史等）。

## 五、日志位置

- macOS：`~/Library/Logs/WebScoop/main.log`
- Windows：`%USERPROFILE%\AppData\Roaming\WebScoop\logs\main.log`

排查代理/证书问题时，先看日志里的 `[cert]`、`proxy` 前缀行。

## 六、常见问题

- **点初始化后一直回到初始化界面**：多为证书「已安装但未信任」。日志会出现 `verify-cert result ok= false` 与 `CSSMERR_TP_NOT_TRUSTED`。新版一键会直接弹原生授权框，输入登录密码即可；若之前用的是旧版（osascript 提权那套），升级后重点一次「一键初始化」即可修好。
- **一键时看到「添加证书」框（钥匙串：登录）**：这是打开 `.pem` 的多余提示，证书早已在钥匙串里，点「取消」不影响；真正设信任的是随后的原生授权框（或引导页的「重试自动信任」）。
- **开了 VPN/其他代理后无法捕获**：WebScoop 依赖系统代理，和其他全局代理/VPN 冲突。捕获期间请关闭其他代理。
- **视频号无声/播放异常**：确保用的是桌面微信播放，且证书已被信任。
