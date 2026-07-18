# WeChat Desktop Reliable Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unreliable embedded WeChat login flow with a desktop WeChat handoff that copies the target link, launches WeChat, and captures the video when the user opens and plays it.

**Architecture:** The renderer continues resolving share-link metadata and creating an `infoOnly` placeholder. A new main-process IPC copies the share URL with Electron's clipboard API and launches the registered `weixin://` protocol. Existing hoxy injection observes the real desktop WeChat page, emits the media URL and decode key, and the state machine merges that capture into the placeholder by author and description.

**Tech Stack:** Electron IPC, Electron clipboard/shell, React, XState, hoxy

---

### Task 1: Add the desktop WeChat handoff IPC

**Files:**
- Modify: `electron/ipc.js`

**Steps:**
1. Import Electron's `clipboard`.
2. Register `invoke_在微信中打开`.
3. Validate the URL, copy it to the clipboard, and call `shell.openExternal('weixin://')`.
4. Return a structured success result and surface launch failures to the renderer.

### Task 2: Switch WeChat actions to reliable mode

**Files:**
- Modify: `src/App.jsx`

**Steps:**
1. Add one renderer callback for the new IPC and user guidance.
2. After metadata resolution, create the placeholder and invoke the desktop WeChat handoff instead of opening the embedded window.
3. Make the top-level browser button use the same handoff for WeChat URLs.
4. Replace the placeholder row's scan-login action with an open-in-WeChat retry action.

### Task 3: Update placeholder terminology

**Files:**
- Modify: `src/fsm.js`
- Modify: `src/App.jsx`

**Steps:**
1. Change `待登录` to `待播放`.
2. Explain that opening and playing the copied link in desktop WeChat completes capture.
3. Keep `infoOnly` and the existing author/description merge behavior unchanged.

### Task 4: Verify

**Steps:**
1. Run `npm run build-electron`.
2. Run `npm run build-web`.
3. Inspect the diff for accidental changes.
4. Manually verify: paste a `weixin.qq.com/sph/...` URL, click parse, confirm clipboard content and WeChat launch, then open/play the link and confirm the placeholder gains a download action.
