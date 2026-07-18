# P0/P1 Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复全部已确认 P0/P1，同时保持视频号捕获和解密链路稳定。

**Architecture:** 将 CA、系统代理和 hoxy 生命周期变为主进程管理的本机状态；下载使用独占文件与 pipeline；renderer 通过 contextBridge 白名单访问主进程。所有迁移均带失败回滚和视频号回归。

**Tech Stack:** Electron 26、Node.js、hoxy、系统 OpenSSL、React、XState、Jest

---

### Task 1: 本机独立 CA

**Files:**
- Create: `electron/localCertificate.js`
- Modify: `electron/const.js`
- Modify: `electron/cert.js`
- Modify: `electron/proxyServer.js`
- Modify: `package.json`
- Delete: `public/keys/private.pem`
- Delete: `public/keys/private.key`
- Delete: `public/keys/public.pem`
- Delete: `public/keys/public.crt`

**Steps:**
1. 添加本机证书路径和旧证书常量。
2. 使用参数化 `openssl req` 生成 `CA:TRUE` 自签名证书。
3. 原子写入证书并将私钥设为 `0600`。
4. 初始化时删除旧共享根并安装新证书。
5. hoxy 启动前确保本机证书存在。
6. 验证证书为 CA、私钥与证书匹配且发布目录不含私钥。

### Task 2: 收窄 TLS 放宽范围

**Files:**
- Create: `electron/scopedTls.js`
- Modify: `electron/proxyServer.js`
- Test: `src/__tests__/scopedTls.test.js`

**Steps:**
1. 测试微信域名边界白名单。
2. 删除全局 `NODE_TLS_REJECT_UNAUTHORIZED`。
3. 包装 `https.request`，仅对白名单上游设置 `rejectUnauthorized:false`。
4. 验证普通 HTTPS 请求仍校验证书。

### Task 3: 系统代理快照与恢复

**Files:**
- Rewrite: `electron/setProxy.js`
- Modify: `electron/const.js`
- Test: `src/__tests__/setProxy.test.js`

**Steps:**
1. 测试 macOS networksetup 输出解析。
2. 启动前持久化原 HTTP/HTTPS 代理状态。
3. 设置失败时立即恢复。
4. 退出时仅在当前代理仍属于 WebScoop 时恢复原状态。
5. Windows 保存并恢复 `ProxyEnable`/`ProxyServer`。

### Task 4: hoxy 单例与有界缓存

**Files:**
- Create: `electron/expiringMap.js`
- Modify: `electron/proxyServer.js`
- Test: `src/__tests__/expiringMap.test.js`

**Steps:**
1. 测试 TTL 和容量淘汰。
2. 将 Referer/媒体去重表换成有界 Map。
3. 保存 server、start Promise、timer 和当前窗口。
4. 重复启动复用 server。
5. 失败/退出统一清理所有资源。

### Task 5: 下载不覆盖与半成品清理

**Files:**
- Modify: `electron/utils.js`
- Modify: `electron/ipc.js`
- Test: `src/__tests__/downloadPaths.test.js`

**Steps:**
1. 测试同名文件生成 `(1)` 后缀。
2. 使用 `path.join` 和独占写入。
3. 使用 `stream/promises.pipeline`。
4. 失败时删除半成品。
5. 进度总长度未知时不发送无效百分比。

### Task 6: Renderer 权限收敛

**Files:**
- Create: `electron/preload.js`
- Modify: `webpack.electron.js`
- Modify: `electron/index.js`
- Modify: `electron/ipc.js`
- Modify: `src/App.jsx`
- Modify: `src/fsm.js`

**Steps:**
1. 多入口构建 `index.js` 和 `preload.js`。
2. contextBridge 暴露白名单 invoke/on。
3. renderer 移除 Electron 直接 import。
4. 主窗口开启隔离与 Web 安全。
5. 外链只允许 HTTP(S)，文件只允许打开已完成下载。

### Task 7: 其余 P1

**Files:**
- Modify: `electron/wechatBrowser.js`
- Modify: `electron/index.js`

**Steps:**
1. 视频号窗口关闭时注销 Cookie 监听器。
2. 更新源切换到 `floraldeer/WebScoop`。

### Task 8: 全量验证

**Steps:**
1. 运行全部 Jest 测试。
2. 运行快手真实链接解析，确认大小非零。
3. 运行 Electron/Web 生产构建。
4. 打包 Universal DMG，确认不包含 CA 私钥。
5. 检查视频号核心测试、构建和差异。

**结果：**
- 7 个测试套件、31 个测试全部通过。
- Electron/Web 生产构建通过。
- Universal DMG 为 `x86_64 arm64`，深度签名、hardened runtime 与 Renderer sandbox 验证通过。
- DMG 和 ASAR 未包含共享 CA 私钥、旧证书或 `w_c.exe`。
