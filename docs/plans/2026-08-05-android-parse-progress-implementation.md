# Android Parse Progress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add truthful elapsed-time feedback during Android media parsing and keep the cancel label visually centered.

**Architecture:** Keep parsing ownership in `WebScoopApp`. Drive elapsed seconds with a composition-scoped `LaunchedEffect`, isolate the stage-label rule in a small testable function, and use a `Box` overlay inside the existing button so the spinner does not shift the label.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Kotlin coroutines, JUnit

---

### Task 1: Lock the stage-label contract

**Files:**
- Create: `android-app/app/src/test/java/com/lurich/webscoop/presentation/AppProgressTest.kt`
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`

**Step 1: Write the failing test**

Add assertions for the stage boundary:

```kotlin
assertEquals("正在解析媒体 · 0秒", parseProgressText(0))
assertEquals("正在解析媒体 · 29秒", parseProgressText(29))
assertEquals("网络响应较慢 · 30秒", parseProgressText(30))
```

**Step 2: Run the focused test**

Run:

```bash
cd android-app
./gradlew testDebugUnitTest --tests '*AppProgressTest'
```

Expected: compilation fails because `parseProgressText` does not exist.

**Step 3: Implement the label function**

Add an internal function that uses 30 seconds as the only stage threshold and coerces negative input to zero.

**Step 4: Run the focused test again**

Expected: all `AppProgressTest` assertions pass.

### Task 2: Add composition-scoped elapsed time

**Files:**
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`

**Step 1: Add elapsed state**

Store `parseElapsedSeconds` next to `isParsing` and reset it before launching each parse.

**Step 2: Add lifecycle-aware ticking**

Use:

```kotlin
LaunchedEffect(isParsing) {
    if (!isParsing) {
        parseElapsedSeconds = 0
        return@LaunchedEffect
    }
    while (true) {
        delay(1_000)
        parseElapsedSeconds += 1
    }
}
```

**Step 3: Render stage feedback**

When `isParsing` is true, render `parseProgressText(parseElapsedSeconds)` below the button row with centered secondary text.

### Task 3: Center the cancel label

**Files:**
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`

**Step 1: Replace sequential spinner/text layout**

Use a full-width `Box` inside the parsing button.

**Step 2: Position elements independently**

- Spinner: `Alignment.CenterStart`
- Cancel label: `Alignment.Center`

This keeps the label centered independently of spinner width.

### Task 4: Verify and commit

**Files:**
- Verify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`
- Verify: `android-app/app/src/test/java/com/lurich/webscoop/presentation/AppProgressTest.kt`

**Step 1: Run complete checks**

```bash
cd android-app
./gradlew -Pkotlin.compiler.execution.strategy=in-process \
  testDebugUnitTest lintDebug assembleDebug
```

Expected: all tasks succeed.

**Step 2: Install on the API 35 emulator**

Verify the initial stage text, timer increment, cancel action, centered cancel label, and idle-state restoration.

**Step 3: Check formatting**

```bash
git diff --check
```

Expected: no output.

**Step 4: Commit**

```bash
git add docs/plans/2026-08-05-android-parse-progress-design.md \
  docs/plans/2026-08-05-android-parse-progress-implementation.md \
  android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt \
  android-app/app/src/test/java/com/lurich/webscoop/presentation/AppProgressTest.kt
git commit -m "feat: improve Android parse progress feedback"
```
