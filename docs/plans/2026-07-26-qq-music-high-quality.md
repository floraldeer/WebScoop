# QQ 音乐高质量完整音频 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 登录 QQ 音乐后下载账号有权访问的最高音质完整音频，并保留无权限时的官方试听兜底。

**Architecture:** 根据歌曲文件大小构造 FLAC、320K MP3、128K MP3、192K AAC、96K AAC 候选，在一次 vkey 请求中批量申请。响应按预设优先级选择第一个有权访问的完整音频，并将音质、扩展名和大小透传到现有捕获列表与下载队列。

**Tech Stack:** Electron 26、React 18、XState 4、Axios、Jest、ESLint、Prettier

---

### Task 1: 定义音质候选和批量 payload

**Files:**
- Modify: `src/__tests__/platformParsers.test.js`
- Modify: `electron/platformParsers.js`

**Step 1: 写失败测试**

```js
expect(buildQqMusicVkeyPayload(songWithAllSizes, cookie, false, 'guid').req_0.param.filename)
  .toEqual([
    'F000002ucvcB2rA3n4.flac',
    'M800002ucvcB2rA3n4.mp3',
    'M500002ucvcB2rA3n4.mp3',
    'C600002ucvcB2rA3n4.m4a',
    'C400002ucvcB2rA3n4.m4a',
  ]);
```

同时断言 `songmid` 和 `songtype` 数组长度与 `filename` 一致。

**Step 2: 运行测试确认失败**

```bash
npm test -- --runTestsByPath src/__tests__/platformParsers.test.js --watchAll=false
```

Expected: FAIL，当前 payload 仅包含 `C400`。

**Step 3: 实现候选表**

在 `electron/platformParsers.js` 中定义只包含前缀、后缀、大小字段和展示名称的常量。根据
`song.file` 过滤不可用档位，批量构造 payload；试听仍只构造 `RS02`。

**Step 4: 运行测试确认通过**

Run 同 Step 2。

Expected: PASS。

### Task 2: 按优先级选择最高授权音质

**Files:**
- Modify: `src/__tests__/platformParsers.test.js`
- Modify: `electron/platformParsers.js`

**Step 1: 写失败测试**

覆盖两个响应：

```js
expect(selectQqMusicAudio(flacSuccess, song)).toMatchObject({
  quality: 'FLAC 无损',
  extension: '.flac',
});

expect(selectQqMusicAudio(flacDeniedMp3Success, song)).toMatchObject({
  quality: 'MP3 320K',
  extension: '.mp3',
});
```

**Step 2: 运行测试确认失败**

Expected: FAIL，当前代码只返回首个非空 URL，没有音质元数据。

**Step 3: 实现选择逻辑**

按候选表顺序和响应 `filename` 精确匹配 `midurlinfo`，只接受 `result === 0 && purl`。
返回 URL、音质、扩展名和大小。未知文件名使用 `path.extname` 兜底。

**Step 4: 运行测试确认通过**

Expected: PASS。

### Task 3: 接入解析流程和试听回退

**Files:**
- Modify: `electron/platformParsers.js`
- Test: `src/__tests__/platformParsers.test.js`

**Step 1: 更新解析级 Mock**

模拟完整批量响应全部 `104003`，第二次试听响应成功，确认现有试听行为不回归。

**Step 2: 接入完整音频结果**

`parseQqMusic` 使用选择结果填充：

```js
{
  quality: selected.quality,
  extension: selected.extension,
  size: inspectedSize || selected.size,
  isPreview: false,
}
```

试听结果使用 `quality: '官方试听'`。

**Step 3: 运行 QQ 音乐相关测试**

```bash
npm test -- --runTestsByPath src/__tests__/platformParsers.test.js src/__tests__/downloadPaths.test.js --watchAll=false
```

Expected: PASS。

### Task 4: 透传并展示音质

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/fsm.js`
- Modify: `src/components/CaptureTable.jsx`

**Step 1: 透传 `quality`**

从解析结果发送到 `e_视频捕获`，在 FSM 新记录和试听升级完整音频时保存。

**Step 2: 展示音质标签**

在标题区域显示 `quality` Tag。试听继续使用 warning Tag；完整 FLAC/MP3 使用 success Tag。

**Step 3: 调整成功提示**

完整音频提示包含实际音质，例如：`QQ音乐 FLAC 无损解析成功，已加入下载列表`。

### Task 5: 验证、打包、提交和推送

**Files:**
- Verify: all modified files
- Output: `packs/WebScoop-2.2.8-universal.dmg`

**Step 1: 运行静态检查和全量测试**

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

Expected: 生成 Universal DMG。

**Step 3: 提交**

```bash
git add docs/plans/2026-07-26-qq-music-high-quality*.md electron/platformParsers.js \
  src/App.jsx src/fsm.js src/components/CaptureTable.jsx src/__tests__/platformParsers.test.js
git commit -m "feat: download highest available QQ music quality"
```

**Step 4: 推送**

```bash
git push origin master
```

Expected: `origin/master` 更新到新提交。
