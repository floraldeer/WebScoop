# macOS Proxy Safe Shutdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure WebScoop never leaves macOS HTTP/HTTPS proxies pointing at its stopped local server, while preserving proxy changes made by Feilian or other software.

**Architecture:** Keep the existing persisted proxy snapshot and add pure ownership/state comparison helpers. Restore only proxy entries still owned by WebScoop, retry transient `networksetup` failures, verify the resulting state, and use a final owned-proxy disable fallback. The local hoxy server remains alive until proxy restoration succeeds.

**Tech Stack:** Electron, Node.js `child_process.execFile`, macOS `networksetup`, Jest, electron-builder.

---

### Task 1: Define Proxy Ownership and Restore Semantics

**Files:**

- Modify: `electron/proxyState.js`
- Test: `src/__tests__/setProxy.test.js`

**Step 1: Write failing tests**

Add cases proving that:

```js
isOwnedMacProxy(
  { enabled: true, server: '127.0.0.1', port: 61522 },
  { host: '127.0.0.1', port: 61522 },
);
```

returns `true`, while a Feilian-owned proxy or disabled proxy returns `false`. Add state-match cases where disabled states ignore stale server and port values.

**Step 2: Run the focused test**

Run:

```bash
npm test -- --runInBand src/__tests__/setProxy.test.js
```

Expected: FAIL because the helpers are not exported.

**Step 3: Implement pure helpers**

Export `isOwnedMacProxy` and `matchesMacProxyState` from `electron/proxyState.js`. Enabled states must match server and port; disabled expected states only require `enabled === false`.

**Step 4: Run the focused test**

Expected: PASS.

### Task 2: Make macOS Proxy Restoration Verified and Resilient

**Files:**

- Modify: `electron/setProxy.js`
- Test: `src/__tests__/setProxy.test.js`

**Step 1: Implement bounded retry**

Add a small internal retry loop with short delays. For each snapshotted network service and each HTTP/HTTPS proxy:

1. Read current state.
2. Stop immediately if another application has replaced WebScoop's proxy.
3. Restore the original state.
4. Read back and verify the state.
5. Retry transient failures.
6. If still owned after retries, disable only that WebScoop-owned proxy and verify it is disabled.

Continue processing other services after one service fails and collect failures for the final error.

**Step 2: Preserve recovery data correctly**

Delete `proxy-state.json` only after no snapshotted proxy remains owned by WebScoop. Keep it when restoration cannot be confirmed so a later startup can recover it.

**Step 3: Add diagnostic logging context**

Errors must identify the network service and HTTP/HTTPS protocol without exposing credentials or unrelated network configuration.

**Step 4: Run tests**

Run:

```bash
npm test -- --runInBand
npm run lint
npm run format:check
```

Expected: all checks pass.

### Task 3: Enforce Safe Shutdown Ordering

**Files:**

- Modify: `electron/proxyServer.js`

**Step 1: Stop swallowing restore errors**

Change `shutdownServer()` so `closeProxy()` must complete before hoxy is closed. Log and propagate restoration failures instead of silently continuing with an unreachable system proxy.

**Step 2: Keep quit cleanup idempotent**

The `before-quit` handler must run cleanup once, wait for restoration, then call `app.exit()`. If restoration fails, log the failure and retain the local proxy process rather than knowingly leaving macOS pointed at a dead port.

**Step 3: Verify Electron build**

Run:

```bash
npm run build-electron
npm run build-web
```

Expected: both builds succeed.

### Task 4: Regression Verification

**Files:**

- Inspect: `~/.webscoop/proxy-state.json`

**Step 1: Capture baseline**

Read `scutil --proxy` and relevant `networksetup -getwebproxy` / `-getsecurewebproxy` output.

**Step 2: Launch and quit WebScoop**

Confirm WebScoop temporarily owns the HTTP/HTTPS proxy while running. Quit normally and confirm neither proxy points to WebScoop's former local port.

**Step 3: Verify external takeover protection**

Use automated helper tests to confirm a proxy state changed away from WebScoop ownership is never overwritten during cleanup.

### Task 5: Build Installable Packages

**Files:**

- Output: `packs/WebScoop-2.2.8-universal.dmg`
- Output: `packs/WebScoop-2.2.8-android-debug.apk`

**Step 1: Build Android APK**

Run Gradle `assembleDebug` with the project-local Android SDK.

**Step 2: Build macOS Universal DMG**

Run:

```bash
npm run pack:mac
```

The DMG build requires unsandboxed `hdiutil` access to macOS disk devices. Verify the resulting DMG can be attached and contains `WebScoop.app`.

**Step 3: Record checksums**

Run SHA-256 over both final packages and report their paths and sizes.
