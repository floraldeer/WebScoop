# QQ 音乐下载 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 QQ 音乐分享链接优先下载账号有权访问的完整音频，并在无权限时自动提供明确标注的官方试听下载。

**Architecture:** 在现有 `platformParsers.js` 内替换 QQ 音乐旧 vkey 请求，使用当前 `music.vkey.GetVkey/UrlGetVkey` 协议并按完整音频、试听音频顺序解析。新增安全的 QQ 音乐登录窗口共享 Electron Cookie，解析结果通过现有 FSM 和下载队列透传试听标记及正确扩展名。

**Tech Stack:** Electron 26、React 18、XState 4、Axios、Jest、ESLint、Prettier

---

### Task 1: 固化 QQ 音乐音源选择行为

**Files:**
- Modify: `src/__tests__/platformParsers.test.js`
- Modify: `electron/platformParsers.js`

**Step 1: 写失败测试**

为以下纯逻辑增加测试：

```js
expect(buildQqMusicVkeyRequest(song, credential, false)).toMatchObject({
  req_0: {
    module: 'music.vkey.GetVkey',
    method: 'UrlGetVkey',
    param: { filename: ['C400002ucvcB2rA3n4.m4a'] },
  },
});

expect(selectQqMusicAudio(result104003, previewSuccess)).toMatchObject({
  extension: '.mp3',
  isPreview: true,
});
```

**Step 2: 运行测试确认失败**

Run:

```bash
npm test -- --runTestsByPath src/__tests__/platformParsers.test.js --watchAll=false
```

Expected: FAIL，提示新导出函数不存在。

**Step 3: 实现最小纯逻辑**

在 `electron/platformParsers.js` 中：

- 根据 `song.file.media_mid` 构造 `C400{media_mid}.m4a`。
- 使用 `music.vkey.GetVkey/UrlGetVkey`。
- 构造 Web `comm` 参数并使用登录 Cookie 中的账号信息。
- 增加 `RS02{media_mid}.mp3` 试听请求构造。
- 将 `purl` 与响应 `sip` 安全拼接为完整 URL。

**Step 4: 运行测试确认通过**

Run 同 Step 2。

Expected: PASS。

### Task 2: 实现完整音频优先和试听兜底

**Files:**
- Modify: `electron/platformParsers.js`
- Test: `src/__tests__/platformParsers.test.js`

**Step 1: 写失败测试**

Mock 两次 Axios vkey 请求：

```js
axios.get.mockResolvedValueOnce(songInfo);
axios.post
  .mockResolvedValueOnce(fullDenied)
  .mockResolvedValueOnce(previewSuccess);

await expect(parsePlatformVideo(qqMusicUrl)).resolves.toMatchObject({
  description: '【试听】爱情买卖 - 慕容晓晓',
  platform: 'QQ音乐',
  extension: '.mp3',
  isPreview: true,
});
```

**Step 2: 运行测试确认失败**

Run:

```bash
npm test -- --runTestsByPath src/__tests__/platformParsers.test.js --watchAll=false
```

Expected: FAIL，当前实现仍抛出 `104003`。

**Step 3: 实现解析流程**

- 先请求完整 `C400` 音频。
- `result === 0 && purl` 时返回完整音频。
- `result === 104003` 或空 `purl` 时请求 `RS02` 试听。
- 试听成功时设置 `isPreview: true`、`.mp3` 和 `【试听】` 标题。
- 两个请求都失败时抛出包含业务结果码的错误。

**Step 4: 运行测试确认通过**

Run 同 Step 2。

Expected: PASS。

### Task 3: 增加安全的 QQ 音乐登录窗口

**Files:**
- Modify: `electron/ipc.js`
- Modify: `electron/preload.js`
- Modify: `src/App.jsx`

**Step 1: 增加 IPC 失败测试或静态断言**

确认 preload 白名单尚未包含 `invoke_打开QQ音乐`，并记录预期安全配置：

```js
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
}
```

**Step 2: 实现主进程窗口**

在 `electron/ipc.js` 中维护单例 QQ 音乐窗口：

- 校验 URL host 必须为 `y.qq.com` 或其子域。
- 使用 `session.defaultSession`。
- 禁止 Node 集成，开启 sandbox。
- 已存在时复用并聚焦窗口。
- `closed` 后清空引用。

**Step 3: 接入前端“打开链接”**

在 `src/App.jsx` 中识别 QQ 音乐 URL，调用 `invoke_打开QQ音乐`；其他平台继续调用
`invoke_打开外部链接`。

**Step 4: 构建验证**

Run:

```bash
npm run build-electron
```

Expected: 编译成功，仅允许项目已知的 `any-promise` warning。

### Task 4: 透传试听状态并改进提示

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/fsm.js`
- Modify: `src/components/CaptureTable.jsx`
- Modify: `src/constants.js`

**Step 1: 透传 `isPreview`**

从解析结果发送到 `e_视频捕获`，在 FSM 捕获记录和更新合并逻辑中保存。

**Step 2: 调整用户提示**

- 完整音频：`QQ音乐解析成功，已加入下载列表`。
- 试听音频：`完整音频需要 QQ 音乐登录权限，已加入官方试听；登录后可重新解析`。
- 表格标题保留 `【试听】`，不把试听显示为完整歌曲。

**Step 3: 回归下载扩展名**

确认试听记录下载事件携带 `.mp3`，完整音频携带 `.m4a`。

### Task 5: 全量验证和重新打包

**Files:**
- Verify: all modified source and test files
- Output: `packs/WebScoop-2.2.8-universal.dmg`

**Step 1: 格式检查**

```bash
npm run format:check
```

Expected: PASS。

**Step 2: ESLint**

```bash
npm run lint
```

Expected: PASS。

**Step 3: 全量单测**

```bash
npm test -- --watchAll=false
```

Expected: 所有测试通过。

**Step 4: macOS 打包**

```bash
npm run pack:mac
```

Expected: 生成 Universal DMG；允许已知 `any-promise` warning 和无 Developer ID 签名提示。

**Step 5: 检查产物**

```bash
ls -lh packs/WebScoop-2.2.8-universal.dmg
```

Expected: 文件存在且大小非零。
