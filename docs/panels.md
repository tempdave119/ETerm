---
name: "panels.md 面板停靠规范"
description: "可停靠面板的数据结构、组件职责、交互约定与扩展步骤"
---

# 面板停靠规范

## 目标与范围

- 四个可停靠面板：会话 / 文件 / 系统资源 / 传输队列。设置与命令面板是弹层，不参与停靠。
- 三个停靠区：左 240px、右 300px、底 160px，整体尺寸固定。
- 面板归哪个区、区内顺序、区内分隔比例都可配置并持久化。

## 数据结构

`layout.json` 的 `panels` 段：

```json
{
  "version": 1,
  "splits": { "local": { "type": "leaf" } },
  "panels": {
    "docks": { "left": ["sessions"], "right": ["files", "monitor"], "bottom": ["transfers"] },
    "dividers": { "left": [], "right": [0.4], "bottom": [] }
  }
}
```

- `docks[dock]` 是有序面板 id 列表，空数组表示该区不渲染。
- `dividers[dock]` 是累计比例（0.15–0.85，相邻至少 0.1），长度 = 面板数 − 1；渲染时按相邻差值换算 flexGrow。
- 同一面板只能出现在一个区；未知 id、弹层面板、重复 id 在解析时丢弃。
- 示例里的 `monitor` 是用户后开的系统资源面板；出厂默认右栏只有 `files`（`defaultPanelLayout`），`monitor` 默认关闭。
- 旧格式 `{ files: boolean, monitor: boolean }` 自动迁移：`files` 进右栏，`monitor` 追加到右栏，其余用默认布局。

## 组件职责

| 文件 | 职责 |
| --- | --- |
| `src/shared/panels.ts` | 类型、默认值、解析与迁移、纯函数（`movePanel` / `removePanel` / `panelDockOf` / `setDivider` / `isPanelOpen`） |
| `src/shell/panels/registry.ts` | 面板元数据（id / 标题 / `defaultDock` / `defaultOpen`）与 `panelsInDock(layout, dock)` |
| `src/shell/components/DockColumn.tsx` | 单个停靠区：面板叠放、可拖分隔、rAF 节流 |
| `src/shell/components/PanelFrame.tsx` | 面板外壳：标题、actions 插槽、齿轮菜单（左 / 右 / 底 / 关闭）、关闭按钮 |
| `src/shell/App.tsx` | `renderPanel(id, dock)` 映射与三段 dock 装配；布局读写走 `getPanelLayout` / `savePanelLayout` |

## 交互约定

- 齿轮菜单选项固定为「左侧 / 右侧 / 底部 / 关闭」，当前所在区置灰；点击外部或 Escape 关闭菜单。
- 设置面板「面板布局」与齿轮菜单等价；选择当前所在区不产生写入。
- 拖动分隔只改内存，`pointerup` 才落盘；拖动中每帧最多提交一次比例。
- 关闭面板 = 从 `docks` 移除；重新打开时回到 `defaultDock`。
- 面板常驻：显隐只看布局。`config.files.openByDefault` 只表示连接时自动展开文件面板，不强制关闭用户手动打开的面板。

## 新增一个可停靠面板

1. 在 `PanelId` 与 `DOCKABLE_PANEL_IDS` 增加 id（`src/shared/panels.ts`）。
2. 在 `PANELS` 增加元数据：标题、`defaultDock`、`defaultOpen`（`src/shell/panels/registry.ts`）。
3. 在 `App.tsx` 的 `renderPanel` 增加分支，内容包进 `PanelFrame`，并通过 `onMove` 接到 `movePanelTo`。
4. 补 `tests/shell/panels.test.ts` 的默认布局断言；涉及可见行为时补 smoke 断言。

## 边界

- 停靠区宽高固定，不做整体尺寸拖动。
- 面板不允许多实例；面板移到窄栏（如传输队列放右侧）可能拥挤，属预期。
- 全部面板关闭时三个 `DockColumn` 都不渲染，工作区自行撑满。

## 验证

- 单测：`npm test`。`tests/shell/panels.test.ts` 覆盖默认布局、旧格式迁移、去重、移动、关闭、分隔夹取。
- 冒烟：`npm run smoke` 覆盖右侧双面板、拖动分隔落盘、重载后比例恢复、齿轮与设置双入口换区、全关面板后工作区撑满。
