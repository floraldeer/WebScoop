# 微信视频号指定 URL 捕获 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复桌面微信捕获数条后停止的问题，并将真实视频精确绑定到用户粘贴的分享 URL。

**Architecture:** 注入脚本上报候选媒体，hoxy 上报真实 CDN 活动，新增的主进程协调器跨页面完成双向配对。视频号 IPC 注册当前目标 URL，前端按 `shareUrl` 精确合并并回填解密信息。

**Tech Stack:** Electron、hoxy、React、XState、Node.js Map、Jest

---

### Task 1: 主进程捕获协调器

**Files:**
- Create: `electron/wechatCaptureCoordinator.js`
- Test: `src/__tests__/wechatCaptureCoordinator.test.js`

**Steps:**
1. 写入候选先到和活动先到的失败测试。
2. 写入目标元信息过滤、重复活动去重和 TTL 清理测试。
3. 运行 `npx react-scripts test --watchAll=false electron/wechatCaptureCoordinator.test.js`，确认测试失败。
4. 实现候选表、活动表、目标任务、配对和清理。
5. 再次运行测试，确认全部通过。

### Task 2: 注入与代理接线

**Files:**
- Modify: `electron/proxyServer.js`

**Steps:**
1. 将注入脚本的媒体候选以结构化事件发送到主进程，不再依赖页面内 `pendingByKey`。
2. 给候选补充 `objectId`、当前详情标记和全部清晰度的 `encfilekey`。
3. 在视频号 CDN 请求阶段把活动 key 交给协调器。
4. 协调器匹配后沿用 `VIDEO_CAPTURE` 通道发送结果。
5. 保留其他平台的通用 CDN 分支。

### Task 3: 指定 URL 目标注册

**Files:**
- Modify: `electron/wechatFinder.js`
- Modify: `electron/ipc.js`
- Modify: `src/App.jsx`

**Steps:**
1. 视频号匿名解析结果增加 `shortUri` 和 `dynamicExportId`。
2. 扩展“在微信中打开”IPC，接收 URL、描述和作者并注册目标。
3. 首次解析和占位项重试都传入相同目标元信息。
4. 保持其他平台 `invoke_解析平台视频` 流程不变。

### Task 4: 精确合并与解密信息

**Files:**
- Modify: `src/fsm.js`

**Steps:**
1. 捕获事件透传 `shareUrl`。
2. 优先按 `shareUrl` 合并目标占位项。
3. 合并时回填 `decodeKey`、URL、高清 URL、大小和 `noDecrypt`。
4. 保留非视频号现有去重逻辑。

### Task 5: 验证

**Steps:**
1. 运行协调器单元测试。
2. 运行 `npm run build-electron`。
3. 运行 `npm run build-web`。
4. 检查 `git diff --check` 和最终差异，确认无其他平台行为变更。
