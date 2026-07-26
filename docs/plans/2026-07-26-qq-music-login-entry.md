# QQ 音乐登录入口 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提供明确、常驻且能将登录 Cookie 留在 WebScoop 内的 QQ 音乐登录入口。

**Architecture:** Renderer 工具栏增加独立登录按钮，通过现有 IPC 打开固定 QQ 音乐首页。主进程允许受信 QQ/微信登录域名在安全 Electron 子窗口中打开，并与解析器共享 `defaultSession`。

**Tech Stack:** Electron 26、React 18、Ant Design 4、Jest、ESLint、Prettier

---

### Task 1: 固化 URL 白名单行为

**Files:**
- Create: `electron/qqMusicLogin.js`
- Create: `src/__tests__/qqMusicLogin.test.js`

**Step 1: 写失败测试**

```js
expect(isQqMusicLoginPopupUrl('https://ssl.ptlogin2.qq.com/')).toBe(true);
expect(isQqMusicLoginPopupUrl('https://open.weixin.qq.com/')).toBe(true);
expect(isQqMusicLoginPopupUrl('https://evil.example.com/')).toBe(false);
expect(isQqMusicLoginPopupUrl('javascript:alert(1)')).toBe(false);
```

**Step 2: 运行测试确认失败**

```bash
npm test -- --runTestsByPath src/__tests__/qqMusicLogin.test.js --watchAll=false
```

Expected: FAIL，模块不存在。

**Step 3: 实现纯函数**

新增 `QQ_MUSIC_HOME_URL`、`parseQqMusicUrl` 和 `isQqMusicLoginPopupUrl`，使用标准 `URL`
解析和 label 边界匹配，不使用字符串 `includes`。

**Step 4: 运行测试确认通过**

Expected: PASS。

### Task 2: 修复 Electron 登录弹窗

**Files:**
- Modify: `electron/ipc.js`
- Modify: `electron/qqMusicLogin.js`

**Step 1: 抽取安全窗口参数**

复用统一的安全 `webPreferences`：

```js
{
  session: session.defaultSession,
  webSecurity: true,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
}
```

**Step 2: 调整 `setWindowOpenHandler`**

- 受信登录 URL 返回 `action: 'allow'`。
- 使用 `overrideBrowserWindowOptions` 强制安全参数和父窗口。
- 其他 URL 返回 `action: 'deny'`。
- 不再调用 `shell.openExternal`。

**Step 3: 固定登录首页**

`invoke_打开QQ音乐` 在未传 URL 时使用 `QQ_MUSIC_HOME_URL`；常驻登录按钮不依赖输入框。

### Task 3: 增加常驻登录按钮

**Files:**
- Modify: `src/App.jsx`

**Step 1: 增加按钮处理器**

```js
const openQqMusicLogin = useCallback(() => {
  electronAPI.invoke('invoke_打开QQ音乐', 'https://y.qq.com/');
}, []);
```

**Step 2: 增加工具栏按钮**

使用绿色按钮和明确文本“登录QQ音乐”，放在“打开链接”旁边。

**Step 3: 更新使用说明**

说明完整音频流程为：登录 QQ 音乐后重新解析歌曲链接。

### Task 4: 验证、打包和推送

**Files:**
- Verify: all modified files
- Output: `packs/WebScoop-2.2.8-universal.dmg`

**Step 1: 运行检查**

```bash
npm run format:check
npm run lint
npm test -- --watchAll=false
npm run build-electron
```

Expected: 全部通过，仅允许项目已知 `any-promise` warning。

**Step 2: 打包**

```bash
npm run pack:mac
```

**Step 3: 提交并推送**

```bash
git add docs/plans/2026-07-26-qq-music-login-entry*.md \
  electron/qqMusicLogin.js electron/ipc.js src/App.jsx src/__tests__/qqMusicLogin.test.js
git commit -m "fix: expose QQ music login"
git push origin master
```
