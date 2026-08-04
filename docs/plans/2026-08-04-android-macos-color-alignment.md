# Android macOS Color Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Android's dark green theme with the macOS light indigo color system and establish macOS as the cross-platform color source.

**Architecture:** Keep all Android application colors in the Material 3 theme and Android resource theme. Map the semantic tokens documented in `2026-08-04-cross-platform-color-system-design.md` to `lightColorScheme`, then configure system bars from the same resource colors so startup and Compose rendering remain consistent.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Android resource themes, JUnit

---

### Task 1: Lock the Material color contract

**Files:**
- Create: `android-app/app/src/test/java/com/lurich/webscoop/presentation/theme/ThemeTest.kt`
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/theme/Theme.kt`

**Step 1: Write the failing test**

Add assertions for the macOS semantic colors:

```kotlin
assertEquals(Color(0xFF4F46E5), WebScoopLightColorScheme.primary)
assertEquals(Color(0xFFF8FAFC), WebScoopLightColorScheme.background)
assertEquals(Color(0xFFFFFFFF), WebScoopLightColorScheme.surface)
assertEquals(Color(0xFF1E293B), WebScoopLightColorScheme.onSurface)
assertEquals(Color(0xFF64748B), WebScoopLightColorScheme.secondary)
assertEquals(Color(0xFFE2E8F0), WebScoopLightColorScheme.outline)
```

**Step 2: Run the focused test and verify failure**

Run:

```bash
cd android-app
./gradlew testDebugUnitTest --tests '*ThemeTest'
```

Expected: compilation fails because `WebScoopLightColorScheme` does not exist.

**Step 3: Implement the Material 3 light scheme**

Replace `darkColorScheme` with an internal `lightColorScheme` that maps all core, container, surface, outline, success and error colors from the design document. Keep `WebScoopTheme` as the only public theme entry.

**Step 4: Run the focused test**

Run the same Gradle command.

Expected: `ThemeTest` passes.

### Task 2: Align startup and system bar colors

**Files:**
- Modify: `android-app/app/src/main/res/values/colors.xml`
- Modify: `android-app/app/src/main/res/values/themes.xml`
- Modify: `android-app/app/src/main/java/com/lurich/webscoop/MainActivity.kt`

**Step 1: Add shared Android color resources**

Define `theme_primary`, `theme_background`, `theme_surface`, `theme_text_primary`, and keep the launcher color mapped to the same indigo brand value.

**Step 2: Convert the XML theme to a fixed light appearance**

Use `theme_background` for the window, status bar and navigation bar. Set `windowLightStatusBar`, `windowLightNavigationBar`, and `forceDarkAllowed` to the light-theme values.

**Step 3: Configure edge-to-edge system bars**

Pass explicit `SystemBarStyle.light` values to `enableEdgeToEdge`, using `getColor(R.color.theme_background)` for both system bars.

**Step 4: Build the Android app**

Run:

```bash
cd android-app
./gradlew assembleDebug
```

Expected: build succeeds and produces `app/build/outputs/apk/debug/app-debug.apk`.

### Task 3: Verify and document

**Files:**
- Verify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/App.kt`
- Verify: `android-app/app/src/main/java/com/lurich/webscoop/presentation/login/PlatformLoginDialog.kt`

**Step 1: Audit component color access**

Confirm application surfaces use `MaterialTheme.colorScheme` and no old dark green theme values remain.

**Step 2: Run complete checks**

Run:

```bash
cd android-app
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Expected: all tasks succeed.

**Step 3: Run formatting and diff checks**

Run:

```bash
git diff --check
```

Expected: no output.

**Step 4: Commit**

```bash
git add docs/plans/2026-08-04-cross-platform-color-system-design.md \
  docs/plans/2026-08-04-android-macos-color-alignment.md \
  android-app/app/src/main/java/com/lurich/webscoop/MainActivity.kt \
  android-app/app/src/main/java/com/lurich/webscoop/presentation/theme/Theme.kt \
  android-app/app/src/main/res/values/colors.xml \
  android-app/app/src/main/res/values/themes.xml \
  android-app/app/src/test/java/com/lurich/webscoop/presentation/theme/ThemeTest.kt
git commit -m "feat: align Android colors with macOS"
```
