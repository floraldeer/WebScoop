# WebScoop 跨端颜色系统设计

## 目标

以 macOS/Electron 端现有视觉体系作为 WebScoop 的唯一颜色基准，使 Android 及后续其他客户端在品牌色、页面层级、文字层级和状态语义上保持一致。

## 设计原则

1. macOS/Electron 是颜色设计源，其他端只做平台语义映射。
2. 颜色通过主题系统集中管理，业务组件不得新增品牌色硬编码。
3. Android 固定使用浅色主题，不跟随系统深色模式，不启用动态取色。
4. 平台控件允许保留交互形态差异，但颜色语义必须一致。
5. 平台品牌色（微信、抖音、B站等）仅用于平台标识，不覆盖应用主题色。

## 基础色令牌

| 语义 | 色值 | macOS/Electron | Android Material 3 |
| --- | --- | --- | --- |
| 品牌主色 | `#4F46E5` | `@primary-color` | `primary`、`surfaceTint` |
| 品牌强调色 | `#6366F1` | `@primary-light` | 交互高亮参考色 |
| 品牌浅背景 | `#EEF2FF` | `@primary-bg` | `primaryContainer` |
| 页面背景 | `#F8FAFC` | `@bg-color` | `background` |
| 卡片背景 | `#FFFFFF` | `@card-bg` | `surface` |
| 次级表面 | `#F1F5F9` | 表格悬停/分隔层 | `surfaceVariant`、`secondaryContainer` |
| 主文字 | `#1E293B` | `@text-primary` | `onBackground`、`onSurface` |
| 次级文字 | `#64748B` | `@text-secondary` | `secondary`、`onSurfaceVariant` |
| 占位文字 | `#94A3B8` | 输入提示 | 弱化内容参考色 |
| 边框 | `#E2E8F0` | `@border-color` | `outline` |
| 强边框 | `#CBD5E1` | 禁用/滚动条 | `outlineVariant` |
| 成功色 | `#16A34A` | 高清源/成功状态 | `tertiary` |
| 成功浅背景 | `#DCFCE7` | 成功标签背景 | `tertiaryContainer` |
| 错误色 | `#EF4444` | 错误状态 | `error` |
| 错误浅背景 | `#FEE2E2` | 错误提示背景 | `errorContainer` |

## Android 映射

Android 使用 `lightColorScheme` 定义完整 Material 3 语义色。按钮、输入框、卡片、对话框、进度条、选择框和登录弹窗继续通过 `MaterialTheme.colorScheme` 获取颜色，不建立组件私有色表。

状态栏和导航栏使用页面背景 `#F8FAFC`，系统图标使用深色模式。XML 启动主题和 Compose 运行时系统栏必须使用同一资源，避免启动瞬间出现深色闪烁。

## 后续平台约束

新增 Web、iOS、Windows 或其他客户端时，应先映射本文件中的基础色令牌，再接入平台主题系统。若需要增加新颜色，必须先补充语义名称和跨端用途，不允许只为单一页面添加无语义色值。

## 验收标准

- Android 页面背景、卡片、主按钮、文字和边框与 macOS 色值一致。
- Android 状态栏和导航栏为浅色背景、深色图标。
- Android 不因系统深色模式或动态取色改变品牌色。
- 登录弹窗、下载列表和确认弹窗均继承统一主题。
- 主题颜色具有自动化断言，并通过单测、Lint 和 Debug 构建。
