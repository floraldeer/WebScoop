# macOS WeChat HD Source Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clearly identify independent WeChat Channels HD sources and guarantee downloads prefer them while safely falling back to the normal source.

**Architecture:** Keep the existing `hd_url` data path from the injected WeChat parser through XState. Tighten candidate extraction so only a distinct highest-size source is marked as HD, propagate that source's file size, and centralize preferred URL selection in a tested helper used by the UI.

**Tech Stack:** Electron, injected JavaScript, React, Ant Design, XState, Jest.

---

### Task 1: Test Preferred Media Source Selection

**Files:**

- Create: `src/mediaSource.js`
- Create: `src/__tests__/mediaSource.test.js`

**Step 1: Write failing tests**

Cover:

```js
getPreferredMediaUrl({ url: 'normal', hdUrl: 'hd' }); // hd
getPreferredMediaUrl({ url: 'normal', hdUrl: '' }); // normal
hasDistinctHdSource({ url: 'same', hdUrl: 'same' }); // false
hasDistinctHdSource({ url: 'normal', hdUrl: 'hd' }); // true
```

**Step 2: Run focused tests**

Run `npm test -- --runInBand src/__tests__/mediaSource.test.js`.

Expected: FAIL because the module does not exist.

**Step 3: Implement minimal helpers**

Normalize URL strings with `trim()`. Prefer HD only when non-empty. Treat identical normal and HD URLs as a single source.

### Task 2: Tighten WeChat HD Candidate Extraction

**Files:**

- Modify: `electron/inject/wvdsInjectScript.js`

**Step 1: Select the largest source**

Continue selecting the `spec_video[]` item with the greatest `file_size`.

**Step 2: Mark only a distinct HD source**

Set `hd_url` only when the selected URL differs from the normal URL, or when the API provides an explicit independent `hd_url`.

**Step 3: Report HD size**

When an HD source is selected, set the candidate `size` to its `file_size`; otherwise keep the normal media size.

### Task 3: Make HD Download Behavior Explicit

**Files:**

- Modify: `src/components/CaptureTable.jsx`
- Modify: `src/App.jsx`

**Step 1: Use the tested preferred-source helper**

Use `getPreferredMediaUrl(record)` for initial download, queue matching, and re-download.

**Step 2: Improve visible labels**

Show a green `高清源` tag only when `hasDistinctHdSource(record)` is true. Tooltip: `已捕获独立高清源，下载将优先使用该源`.

**Step 3: Clarify button action**

Display `下载高清` for records with a distinct HD source and `下载` otherwise.

### Task 4: Verify and Package

**Files:**

- Output: `packs/WebScoop-2.2.8-universal.dmg`

**Step 1: Run checks**

Run Jest, ESLint, Prettier, Electron build, and Web build.

**Step 2: Build Universal app**

Build x64 and arm64 into a Universal `.app` and apply local test signing.

**Step 3: Build and verify DMG**

Create a compressed UDZO DMG, verify it with `hdiutil verify`, and record its SHA-256 checksum.
