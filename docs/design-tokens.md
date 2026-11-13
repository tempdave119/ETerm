---
name: "ETerm 设计 token 与控件五态"
description: "F-15 交付物：设计 token 清单、控件五态规则、密度覆盖与禁用做法"
---

# ETerm 设计 token 与控件五态

> token 定义在 `src/shell/styles/tokens.css`；控件样式在 `src/shell/styles/app.css`。新控件只能引用 token，不新增颜色与字号。

## token 清单

| 类别 | token | 值 |
| ---- | ----- | -- |
| 背景 | `--bg-canvas` / `--bg-panel` / `--bg-overlay` | `#16181c` / `#1c1f24` / `#23272e` |
| 文本 | `--text-primary` / `--text-secondary` / `--text-tertiary` / `--text-disabled` | `#e6e8eb` / `#a6adb8` / `#737b86` / `#4d545d` |
| 边框 | `--border-subtle` / `--border-strong` | `#2a2f37` / `#3a4352` |
| 状态 | `--status-success` / `--status-warning` / `--status-danger` / `--status-info` | `#9ece6a` / `#e0af68` / `#f7768e` / `#7aa2f7` |
| 交互遮罩 | `--hover-subtle` / `--hover-overlay` / `--active-overlay` | 白色 4% / 6% / 10% |
| 弹层 | `--backdrop` / `--shadow-overlay` | `rgba(0,0,0,0.45)` / `0 16px 48px rgba(0,0,0,0.45)` |
| 主按钮 | `--primary-bg` / `--primary-text` / `--primary-hover` / `--primary-active` | 浅底深字（深色主题） |
| 字号 | `--font-aux` / `--font-body` / `--font-section` | 12 / 13 / 16 px |
| 字体 | `--font-mono` | SF Mono / Menlo / Monaco |
| 间距 | `--space-tight` / `--space-base` / `--space-container` / `--space-block` / `--space-section` | 4 / 8 / 12 / 16 / 24 px |
| 圆角 | `--radius-sm` / `--radius-md` / `--radius-lg` | 4 / 6 / 8 px |
| 尺寸 | `--row-height` / `--control-height` / `--panel-header-height` | 28 / 32 / 32 px（紧凑模式 24 / 28 / 28） |

终端内部的颜色不引用 CSS 变量：xterm 只认具体值，主题常量在 `TerminalView.tsx` 里与 tokens 保持同值。

## 主题

- 两套主题：深色（`:root` 默认）与浅色（`:root[data-theme="light"]`）。属性挂在 `html` 上，切换只换变量，不重建面板。
- 偏好三档：`system` / `dark` / `light`，存在 `config.json` 的 `ui.theme`；`system` 跟随 `prefers-color-scheme`，系统切换时实时响应。
- 首屏渲染前先按系统主题写好 `data-theme`，避免配置异步加载完成前闪一下深色；窗口 `backgroundColor` 也随系统深浅设置。
- 浅色覆盖范围：背景三层、文本四级、边框两级、状态四色、交互遮罩、弹层遮罩与阴影、主按钮四色。字号 / 间距 / 圆角 / 尺寸不动。
- xterm 用两套调色板（`TERMINAL_THEMES`），切换主题时写 `term.options.theme`，不重建终端实例。
- 外部主题（自定义 token 覆盖）尚未做，需先定文件格式与安全边界。

## 控件五态

| 控件 | 类名 | 默认 | hover | active | focus-visible | disabled |
| ---- | ---- | ---- | ----- | ------ | ------------- | -------- |
| 按钮 | `.button` | 面板底 + 强边框 | `--bg-overlay` | `--bg-canvas` | `--status-info` 描边 | 透明度 0.5 |
| 主按钮 | `.button--primary` | 浅底深字 | 更浅 | 更深 | 同按钮 | 透明度 0.5 |
| 图标按钮 | `.icon-button` | 透明 | 白色 6% | 白色 10% | `--status-info` 描边 | 透明度 0.4、不可点 |
| 标签栏按钮 | `.tabbar__action` | 透明 | 白色 6% | 白色 10% | `--status-info` 描边 | 透明度 0.35 |
| 链接按钮 | `.link-button` | 次级文字 + 下划线 | 主文字 | — | `--status-info` 描边 | — |
| 输入 / 下拉 | `.form-row input` / `select` | 画布底 + 细边框 | 强边框 | — | `--status-info` 描边 | 透明度 0.5 |
| 复选框 | `.settings-check input` | 主题色 accent | — | — | `--status-info` 描边 | — |

- 过渡只给背景 120ms；不做位移与缩放动画。
- 焦点一律用 `:focus-visible`，避免鼠标点击后留下描边。
- 分隔条是拖拽控件：`cursor` 按方向切换，命中区用伪元素撑到 7px，hover 时边框变强。

## 密度

`data-density="compact"` 只覆盖三个尺寸 token（行高、控件高、面板头高），不改颜色与字号。新增控件必须用这三个 token 定高，才能跟着密度一起变。

## 约束

- 禁止在组件里写十六进制颜色；例外只有 xterm 的两套调色板。
- 禁止新增字号；需要层级时用字重与颜色区分。
- 新增颜色必须同时给出深 / 浅两套值，并走 `data-theme` 覆盖。
- 控件五态缺一不可；新增控件先在 `app.css` 补齐五态再接到界面。
- 验证：`npm run smoke` 覆盖设置面板即时生效、主题切换（断言 `data-theme` 与背景色）、字号恢复与分隔条拖拽落盘；`npm run typecheck` 守住组件属性。
