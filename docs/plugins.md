---
name: "ETerm 插件规范"
description: "插件（Plugin）的定位、目录、manifest 草案、生命周期与安全边界；F-60 起逐步实现，当前为设计定稿"
---

# ETerm 插件规范

> 插件（Plugin）是功能层包：用于覆盖宿主明确不做的能力（S3、WebDAV、容器 exec 等），可以携带自己的面板、命令与主题。
>
> 扩展（Extension）是协议层能力包，规范见 `docs/components.md`。两者分目录存放、分套 manifest，互不混用。
>
> 状态：本规范于 2026-11-14 定稿；F-60 管理面、F-61 面板 / 命令 / 主题三类扩展点、F-62 S3 样例与面板消息桥均已完成。

## 目录

```
<用户数据目录>/plugins/<插件 id>/
  manifest.json   插件描述、权限与扩展点声明
  index.cjs       插件入口（CommonJS）
```

- 插件目录独立于扩展的 `<用户数据目录>/components/`，卸载即删除整个目录。
- 启用状态存 `<用户数据目录>/plugins.json`（`{ version, disabled: string[] }`），禁用不删文件。
- 首版只支持「选择本地目录安装」，复制到上述路径；zip 与在线市场后续，市场仍为非目标。

## manifest.json（草案）

```json
{
  "id": "s3-browser",
  "kind": "plugin",
  "apiVersion": "^1.0.0",
  "version": "0.1.0",
  "description": "浏览 S3 bucket 与对象",
  "author": "kevin",
  "entry": "index.cjs",
  "permissions": ["panel", "config"],
  "panels": [{ "id": "s3", "title": "S3", "defaultDock": "right" }],
  "commands": [{ "id": "s3.open", "title": "打开 S3 面板" }],
  "themes": []
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 插件唯一 id（小写字母 / 数字 / `-`），与目录名一致 |
| `kind` | 固定为 `plugin` |
| `apiVersion` | `^1.0.0` 形式，只校验主版本；不匹配时拒绝装载并提示 |
| `version` | 插件自身版本，用于设置面板展示 |
| `description` / `author` | 展示用元数据 |
| `entry` | 相对插件目录的入口，必须在目录内 |
| `permissions` | 展示用权限声明：`panel` / `command` / `theme` / `config`；实际约束仍由宿主服务白名单执行 |
| `panels` / `commands` / `themes` | 扩展点声明，字段随 F-61 实现补全 |

## 面板约定

- 插件目录下放 `panel.html`，宿主以 `eterm-plugin://<id>/panel.html` 加载；`panel.html` 可引用同目录的 CSS / JS / 图片（路径穿越被拒绝）。
- iframe 只开 `sandbox="allow-scripts"`，不给 same-origin：插件脚本拿不到宿主 DOM、preload 与 IPC。
- 插件自行负责面板内样式与滚动；宿主只提供面板头、停靠、尺寸与分隔。
- 已启用插件的面板按 manifest `panels[].defaultDock`（默认 `right`）自动并入布局；禁用后从界面移除，布局位置保留，重新启用后回到原位。

### 面板通信

- iframe 发起：`parent.postMessage({ type: 'eterm-plugin:request', requestId, payload }, '*')`。
- 宿主校验消息来源必须是该面板 iframe，再转给主进程插件的 `registerPanelHandler(panelId, handler)`；回传格式 `{ type: 'eterm-plugin:response', requestId, ok, value | error }`。
- `panelId` 必须是 manifest `panels` 里声明过的 id；payload 上限 256 KB，返回值必须可 JSON 序列化。
- 插件拿不到宿主 DOM 与 IPC，只能通过这条桥请求数据。

## 主题约定

- 插件目录下放 `themes/*.json`，格式与外部主题一致（`ui` 颜色 token + `terminal` 调色板）；安装后出现在设置 → 外观的主题下拉，value 为 `ext:<主题 id>`。
- 主题 id 与外部主题冲突时保留外部主题；禁用插件后主题从下拉消失，已选中时回退系统主题。

## 命令约定

- `manifest.commands` 声明 `{ id, title }`；入口 `index.cjs` 导出 `activate(api)`，用 `api.registerCommand(id, run)` 注册 handler。未声明的命令或非函数 handler 会让该插件的命令整体跳过。
- 宿主内命令 id 为 `plugin:<pluginId>:<commandId>`，出现在 ⌘K 命令面板「插件」分组；可在设置 → 快捷键给插件命令录制组合键，参与冲突检测。
- handler 在主进程执行，抛错会以产品错误条展示；插件入口与扩展一致，是完整 Node 环境、无沙箱。
- `dispose()`（入口导出或 activate 返回值）在宿主退出时调用；禁用 / 卸载后重启生效，命令随之清理。

## 生命周期

| 动作 | 行为 |
| --- | --- |
| 安装 | 选择本地目录 → 校验 manifest 与 `kind` → 复制到 `plugins/<id>/` → 写入启用状态；冲突时不覆盖 |
| 启用 | 从 `plugins.json` 的禁用列表移除；宿主启动时装载 |
| 禁用 | 加入禁用列表；宿主下次启动不装载，已开面板关闭 |
| 卸载 | 二次确认后删除 `plugins/<id>/` 并从状态文件清理 |
| 升级 | 首版仅支持「卸载后重装」；不做原地覆盖 |

首版所有装载变更均在重启后生效，与扩展的安装语义一致。

## 权限与安全

- 插件拿不到宿主的 `connections` / `credentials` / `knownHosts` / `layouts`，与扩展同规则。
- 插件在主进程内运行，是完整 Node 环境，没有 OS 沙箱——安装即信任，只装可信来源。
- `permissions` 只用于安装时展示，不构成运行时强制；真正的边界是宿主服务白名单。
- 插件不能修改布局存储格式、配置 schema 或宿主扩展点；面板只能通过宿主提供的容器挂载。

## 首版限制

- 只支持本地目录安装，不支持 zip / 在线市场。
- 面板不允许多实例。
- 插件自带实现，不支持「插件依赖某个扩展」的组合声明。
- 插件面板的运行状态不进入 `layout.json` 之外的存储；禁用后布局里的面板位置保留，重新启用后回到原位置。

## S3 样例

`examples/plugins/s3-browser/` 是首个真实插件样例：

- 无第三方依赖，手写 SigV4（`UNSIGNED-PAYLOAD`），支持 ListObjectsV2 与 GetObject（单对象上限 5 MB）。
- 面板（`panel.html`）提供 Endpoint / Bucket / Region / Prefix / AK / SK 表单，配置只存在插件自己的源（localStorage），不写 ETerm 配置。
- 签名与请求在主进程插件入口执行，面板通过消息桥取数据；不引入 AWS SDK，也就没有额外依赖面。
- 验证：`tests/modules/s3-browser-plugin.test.ts` 覆盖签名稳定性、路径编码、列表解析与下载；`npm run smoke` 用 mock S3 验证自检命令与面板消息。真实 S3 / MinIO 待手动验证。

## 实现与验收

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| F-60 | manifest 校验、目录 / 状态 / 安装启停卸载、设置面板插件页 | 装 → 禁 → 启 → 卸闭环，卸载无残留（已完成） |
| F-61.1 | 面板扩展点：布局 id、iframe 协议、自动入布局、禁用消失 | smoke：面板出现 → 禁用消失（已完成） |
| F-61.2 | 命令插件：manifest 声明 + activate 注册，命令入 ⌘K 与快捷键编辑 | runtime 6 项单测 + smoke 执行（已完成） |
| F-61.3 | 主题插件：插件 themes/*.json 并入主题下拉 | 单测 + smoke：插件主题出现在下拉（已完成） |
| F-62 | S3 插件样例：手写 SigV4 + 浏览 / 下载面板 | 4 项单测 + smoke mock 验证（已完成） |