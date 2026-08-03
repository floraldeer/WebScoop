# Android Download List Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate link-input clearing from download-list management and add persistent multi-select and clear-all operations without deleting completed media files.

**Architecture:** Continue using Android `DownloadManager` as the task source. Store cleared download IDs in `SharedPreferences` and filter them from the observed queue; only active selected tasks are removed from `DownloadManager`, while completed files remain in `Downloads/WebScoop`. Keep transient selection state in Compose.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Android `DownloadManager`, Android `SharedPreferences`, JUnit.

---

### Task 1: Persist Cleared Download IDs

**Files:**
- Create: `android-app/app/src/main/java/com/lurich/webscoop/data/download/DownloadQueueVisibilityStore.kt`
- Create: `android-app/app/src/test/java/com/lurich/webscoop/data/download/DownloadQueueVisibilityStoreTest.kt`

**Step 1: Write failing tests**

Test that cleared IDs are excluded while other queue items remain visible, duplicate IDs are harmless, and empty hidden-ID sets preserve all items.

**Step 2: Run focused tests**

Run:

```bash
gradle testDebugUnitTest --tests '*DownloadQueueVisibilityStoreTest'
```

Expected: FAIL because the visibility filtering code does not exist.

**Step 3: Implement the store**

Use `Context.getSharedPreferences()` and `putStringSet()` to persist IDs. Return defensive copies of stored sets and filter queue items through a pure `filterVisibleDownloadItems()` function.

**Step 4: Re-run focused tests**

Expected: PASS.

### Task 2: Add Queue Clearing to MediaDownloader

**Files:**
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/data/download/SystemMediaDownloader.kt`
- Modify: `android-app/app/src/test/java/com/lurich/webscoop/data/download/DownloadQueueItemTest.kt`

**Step 1: Extend the interface**

Add:

```kotlin
fun clearQueueItems(items: Collection<DownloadQueueItem>): Int
```

**Step 2: Implement deletion boundaries**

For active items, call `DownloadManager.remove()` to cancel and remove partial data. For completed, failed, or unknown items, do not call `remove()`. Persist all selected IDs as hidden and return the number of distinct cleared records.

**Step 3: Filter observed queue**

Apply the visibility store before emitting each queue snapshot.

**Step 4: Test active-state classification**

Keep active-state tests covering pending, running, and paused statuses so completed files cannot enter the destructive branch.

### Task 3: Build Download List Management UI

**Files:**
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`

**Step 1: Separate input clearing**

Rename the existing action to `清空输入`. It must only reset input, parse result, and the associated message.

**Step 2: Add selection mode**

Add Compose state for management mode, selected download IDs, and pending-clear items. In management mode, show a checkbox on each task card and allow tapping the card to toggle selection.

**Step 3: Add batch actions**

Provide `全选/取消全选`, `清理所选`, `清理全部`, and `完成`. Disable `清理所选` when no items are selected.

**Step 4: Confirm destructive active-task behavior**

Before clearing, show a dialog with the selected count and active-task count. State explicitly that active tasks will be canceled and completed files will remain.

**Step 5: Keep state consistent**

Remove stale IDs from the selection when queue snapshots change. Exit management mode after a confirmed clear.

### Task 4: Verify and Package

**Files:**
- Output: `packs/WebScoop-2.2.8-android-debug.apk`

**Step 1: Run Android checks**

Run `testDebugUnitTest`, `lintDebug`, and `assembleDebug`.

**Step 2: Install on API 35 emulator**

Verify input clearing leaves the download list unchanged, multi-select works, clear-selected removes only selected rows, and clear-all empties the visible list.

**Step 3: Verify completed files**

After clearing a completed row, confirm its file remains under `Downloads/WebScoop`.

**Step 4: Copy the APK**

Copy the verified debug APK to `packs/WebScoop-2.2.8-android-debug.apk` and record its SHA-256 checksum.
