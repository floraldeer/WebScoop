# macOS Video Resolution Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display reliable video resolution and quality tier in the macOS parsed-media list without conflating video clarity with audio quality.

**Architecture:** Add a normalized `resolution` string at the parser boundary and carry it through IPC and XState into the existing capture table. Derive the quality tier from the video's short edge so portrait and landscape videos use consistent labels. Leave the field empty when source metadata is insufficient.

**Tech Stack:** Electron, React, Ant Design, XState, yt-dlp metadata, Jest.

---

### Task 1: Normalize Video Resolution

**Files:**

- Modify: `electron/platformParsers.js`
- Modify: `src/__tests__/platformParsers.test.js`

**Step 1: Write failing tests**

Add tests for:

```js
formatVideoResolution({ width: 1920, height: 1080 }); // 1920×1080 · 1080p
formatVideoResolution({ width: 1080, height: 1920 }); // 1080×1920 · 1080p
formatVideoResolution({ width: 3840, height: 2160 }); // 3840×2160 · 4K
formatVideoResolution({ height: 720 }); // 720p
formatVideoResolution({}); // ''
```

**Step 2: Run focused tests**

Run:

```bash
npm test -- --runInBand src/__tests__/platformParsers.test.js
```

Expected: FAIL because `formatVideoResolution` is not exported.

**Step 3: Implement normalization**

Use positive integer width and height values only. When both dimensions exist, derive the tier from `min(width, height)`; map 2160+ to `4K`, 1440+ to `2K`, 1080+ to `1080p`, 720+ to `720p`, and otherwise use the short-edge value followed by `p`.

**Step 4: Add parser output**

For yt-dlp, read dimensions from the selected top-level info or requested download. For Bilibili, use selected DASH dimensions when available and otherwise map the API quality code. Return the normalized value as `resolution`.

### Task 2: Carry Resolution Through Application State

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/fsm.js`

**Step 1: Add event payload**

Pass `data.resolution` in direct parse events and captured-media events.

**Step 2: Store and merge**

Add `resolution` to new capture items. During duplicate merge, prefer the newer non-empty value and otherwise preserve the existing value.

**Step 3: Verify state tests**

Run the complete Jest suite and confirm media deduplication behavior remains unchanged.

### Task 3: Render Resolution in Capture Table

**Files:**

- Modify: `src/components/CaptureTable.jsx`

**Step 1: Add a video-resolution tag**

Render a blue processing tag beside the platform and title when `record.resolution` is non-empty. Tooltip text: `视频清晰度：<resolution>`.

**Step 2: Preserve audio-quality behavior**

Keep the current QQ Music `quality` tag and preview tag unchanged. Resolution and audio quality must be independent.

### Task 4: Verify and Package

**Files:**

- Output: `packs/WebScoop-2.2.8-universal.dmg`

**Step 1: Run checks**

Run:

```bash
npm test -- --runInBand
npm run lint
npm run format:check
npm run build-electron
npm run build-web
```

**Step 2: Build Universal app**

Build the x64/arm64 Universal `.app` and apply local test signing.

**Step 3: Build and verify DMG**

Create a compressed UDZO DMG, run `hdiutil verify`, and report the SHA-256 checksum.
