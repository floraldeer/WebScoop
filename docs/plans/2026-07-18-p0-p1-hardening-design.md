# P0/P1 安全与可靠性加固设计

## 范围

修复项目审查确认的全部 10 条 P0/P1，同时保护视频号的目标 URL、跨 WebView 候选配对、`decodeKey` 解密和下载行为。

## 证书与 TLS

删除发布包和仓库中的共享 CA 私钥。首次运行时使用 OpenSSL 在 `~/.webscoop/cert/` 生成本机独立 CA，私钥权限设为 `0600`。证书 CN 包含随机安装 ID。初始化时删除旧的 `lecepin-2022-05-19` 共享根证书，并安装本机新证书；新证书未受信时代理不得启动。

移除 `NODE_TLS_REJECT_UNAUTHORIZED=0`。hoxy 上游连接通过受控的 `https.request` 包装器，仅对微信/Tencent 的明确域名关闭上游证书校验，其他更新、平台解析和下载继续使用系统 TLS 校验。

## 代理生命周期

启动代理前保存 macOS 各活跃网络服务或 Windows Internet Settings 的原始代理状态，并持久化到 `~/.webscoop/proxy-state.json`。退出、启动失败或检测到上次崩溃残留时，只在系统当前代理仍指向 WebScoop 时恢复快照，避免覆盖用户后续手工修改。

代理服务器改为主进程单例，保存 hoxy server、启动 Promise、心跳定时器和当前窗口引用。重复启动只更新窗口引用；失败和退出统一关闭 hoxy、TLS spoof server、定时器与协调器。流量去重和 Referer 索引改为带 TTL/容量上限的 Map。

## 下载与窗口安全

下载文件名自动追加 `(1)`、`(2)` 避免覆盖。下载改用 `pipeline`，以独占模式创建文件，失败时销毁上下游并删除半成品。

主窗口启用 `webSecurity`、关闭 `nodeIntegration`、开启 `contextIsolation`，通过 preload 暴露白名单 IPC。外链与下载文件打开操作移入主进程并校验协议/已下载文件集合。视频号窗口关闭时注销 Cookie 监听器。

更新检查改为当前 `floraldeer/WebScoop` 仓库。
