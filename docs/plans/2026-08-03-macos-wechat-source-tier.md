# macOS WeChat Source Tier Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every captured WeChat Channels video visibly identifies whether WebScoop selected an independent HD source or the highest source available from the response.

**Architecture:** Normalize WeChat media variants in a pure main-process helper that selects the largest `spec_video` item and classifies the result as `hd` or `best_available`. Mirror the classification in the injected page extractor, carry `sourceQuality` through XState, and render an explicit tag and download label for both states.

**Tech Stack:** Electron, injected JavaScript, React, Ant Design, XState, Jest.

---

### Task 1: Normalize WeChat Source Variants

**Files:**

- Modify: `electron/proxy/mediaMatchers.js`
- Modify: `src/__tests__/mediaMatchers.test.js`

**Step 1: Write failing tests**

Cover:

1. Multiple `spec_video` entries choose the largest file and classify `hd`.
2. A single source classifies `best_available`.
3. Explicit distinct `hd_url` classifies `hd`.
4. A duplicate HD URL does not classify as independent HD.

**Step 2: Run focused tests**

Run `npm test -- --runInBand src/__tests__/mediaMatchers.test.js`.

Expected: FAIL until the normalized selector exists.

**Step 3: Implement selector**

Export `selectWechatMediaSource(media)` and use it inside `walkFeedMedia()`.

### Task 2: Align Injected Extraction

**Files:**

- Modify: `electron/inject/wvdsInjectScript.js`

**Step 1: Select the largest variant**

Keep selecting the maximum `file_size` entry.

**Step 2: Add source classification**

Emit `source_quality: "hd"` only for a distinct HD URL; otherwise emit `source_quality: "best_available"`.

### Task 3: Carry and Render Source Quality

**Files:**

- Modify: `src/fsm.js`
- Modify: `src/components/CaptureTable.jsx`
- Modify: `src/mediaSource.js`
- Modify: `src/__tests__/mediaSource.test.js`

**Step 1: Store and merge**

Carry `source_quality` into `sourceQuality`; prefer `hd` during duplicate merges.

**Step 2: Render explicit tags**

Render green `高清源` for `hd` and blue `最高可用` for `best_available`.

**Step 3: Clarify download buttons**

Use `下载高清` for HD and `下载最高可用` for a single highest-available source.

### Task 4: Verify and Package

**Step 1: Run checks**

Run Jest, ESLint, Prettier, Electron build, and Web build.

**Step 2: Build Universal DMG**

Build and locally sign the Universal app, create a compressed UDZO DMG, and verify it with `hdiutil verify`.
