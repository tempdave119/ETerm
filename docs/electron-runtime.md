---
name: "electron-runtime.md 运行底座与换壳评估"
description: "ETerm 的应用现状、Electron 依赖面、上游风险传导、版本跟进策略，以及 Tauri / 原生迁移的可行性与成本"
---

# 运行底座与换壳评估

这份文档回答四个问题：ETerm 现在依赖 Electron 到什么程度；Electron 出问题会不会连带 ETerm；Electron 大版本要不要跟、怎么跟；以后想换 Tauri 或原生 Swift，路有多长。

## 一、应用现状（v0.9.0）

- 版本：0.9.0，2026-11-14 打 tag；发布由 tag 触发 GitHub Actions，双架构（x64 / arm64）DMG 由 CI 产出。
- 功能域：会话管理、SSH / SFTP、终端渲染、分屏、面板停靠、配置热生效、主题、本地终端、扩展（串口 / Telnet）、插件（S3 样例）、跳板 / 代理 / 端口转发、自动重连、本机与远端资源监控。
- 验证基线：334 项单元测试、`npm run typecheck`、`npm run smoke`（CDP 界面冒烟）、`npm run ssh-smoke`（模拟 SSH / SFTP / Telnet 端到端）、`npm run swap-smoke`（第二个 SSH adapter 替换验证）。
- 代码规模：`src` / `scripts` / `examples` 约 1.7 万行；`src/core`、`src/modules`、`src/services` 中没有 `import ... from 'electron'`，Electron 只出现在 `src/host/`。

## 二、分层模型

```
macOS（真系统）
└── Electron 运行时发行版
    ├── 内核：Chromium（渲染 / 合成 / 输入）+ Node / V8（主进程 JS 与原生模块）
    └── 外壳：窗口、菜单、托盘、对话框、剪贴板、钥匙串、自定义协议、单实例
        └── ETerm 应用（工作台）
            ├── 应用内核：四端口契约 + 模块注册表 + 内置能力包（SSH / 本地终端）
            ├── 领域服务：连接 / 配置 / 凭据 / 指纹 / 布局 / 传输 / 主题 / 插件 / 窗口状态
            └── 界面层：React + xterm（canvas）+ 分屏 + 面板停靠
```

两个「内核」不要混：

- **Electron 的内核** = Chromium + Node/V8，属于上游，改不了，只能整体换运行时；
- **ETerm 的内核** = `src/core/ports.ts` 的四端口 + manifest 注册表 + 内置能力包，是自研资产，已经通过 21.2 / 21.3 验证过「换实现、拆模块」这两件事。

## 三、Electron 在 ETerm 里具体承担什么

使用面（`src/host/` 内）：

| 能力 | 具体 API | 用途 |
| --- | --- | --- |
| 窗口与生命周期 | `app`、`BrowserWindow`、`screen` | 主窗口、尺寸与位置记忆、多屏夹取 |
| 进程间通信 | `ipcMain`、`ipcRenderer`、`contextBridge` | preload 白名单 API，渲染层不接触凭据 |
| 原生交互 | `dialog`、`clipboard`、`shell`、`webUtils` | 选文件 / 选目录、剪贴板、打开外链、拖拽路径解析 |
| 安全存储 | `safeStorage` | 密码与私钥口令加密（密文落盘，0600） |
| 系统集成 | `Menu`、`Tray`、`nativeImage`、`nativeTheme`、`protocol` | 应用菜单、托盘、模板图标、主题跟随、`eterm-plugin://` 协议 |
| 打包 | electron-builder | asar、`asarUnpack`（node-pty / serialport）、dmg、双架构 |

打包产物里能直接看出 Electron：`ETerm.app/Contents/Frameworks/Electron Framework.framework`、`Resources/app.asar`。

## 四、依赖强度与可替换性

| 层 | 依赖强度 | 能否替换 | 说明 |
| --- | --- | --- | --- |
| 窗口 / 菜单 / 托盘 / 对话框 / 钥匙串 | 强 | 只能连外壳一起换 | 每个 API 都要在新壳里找到等价实现 |
| IPC / preload | 强 | 同上 | 现有白名单与类型契约可复用，传输机制要重写 |
| 渲染（Chromium） | 强 | 随运行时更换 | 换 Tauri 后是 WKWebView，字体度量与 Canvas 行为有差异 |
| Node 运行时 | 中 | 可保留为 sidecar | `ssh2` / `node-pty` / `serialport` 只认 Node，不认 Electron |
| 领域逻辑（core / modules / services） | 无 | 可直接搬走 | 纯 TypeScript，不 import Electron |
| 界面（React / xterm） | 无 | 可直接复用到任意 WebView | 依赖 DOM / Canvas，不依赖 Electron API |

结论：**Electron 的锁只锁在 `src/host/` 与打包配置上**。当前没有 host 抽象层，`import ... from 'electron'` 分散在 `src/host/main.ts`、`preload.ts`、各 `*-ipc.ts`、菜单、托盘与插件协议里；换壳的真实改动面是「整个 host 目录 + preload + 打包」，不是换一个文件。

## 五、上游故障怎么传导到 ETerm

| 故障层 | 传导 | 典型表现 | 现有应对 |
| --- | --- | --- | --- |
| Chromium 渲染 | 直接 | 字形发虚、Canvas 异常、输入法候选框错位 | v0.1 弃用 WebGL，改 canvas 渲染 |
| Node / V8 | 直接 | 原生模块 ABI 不匹配、进程崩溃 | `postinstall` 补 `spawn-helper` 执行位 |
| 原生桥（macOS 集成） | 直接 | 窗口、剪贴板、钥匙串授权、菜单快捷键冲突 | 快捷键用 `event.code` 匹配，避开字符差异 |
| Chromium 安全漏洞（CVE） | 必须跟进 | 不升级即带已知漏洞 | 靠 Electron 版本升级 |
| 未使用的 Electron 能力 | 不传导 | 自动更新、通知、Touch Bar 等出问题与 ETerm 无关 | 不使用即不受影响 |

判断口径：**上游 bug 会传导，但只在你用到的 API 上传导**；「ETerm 一定复现同一个 bug」不成立，反过来「ETerm 一定不受影响」也不成立。

## 六、Electron 的发布节奏与支持窗口

官方策略（electronjs.org 的 `electron-timelines` / `electron-versioning`）：

- major 版本每 **8 周**发布一次，与 Chromium 节奏对齐；
- 只维护**最近 3 个 stable major**，超出即停止安全更新；
- 大多数 Chromium 升级被视为 breaking，兼容修复只回移植到受支持的分支。

按这个节奏推算：当前项目锁定 45.x，46 大约 2027 年初发布、47 约在其后 8 周，**45 的官方支持大约止于 2027 年一季度**。这是估算，以官方发布表为准。

## 七、升级策略（建议并作为执行口径）

**节奏：滞后 1–2 个 major，约每季度跟一次；出现 Chromium 高危漏洞时例外加速。**

流程：

1. 独立分支 `chore/electron-<major>`；`package.json` 里的 `electron` 从 `^` 改成 `~`（只跟 patch），避免 minor 静默升级；
2. 升级后 `npm rebuild` 原生模块，确认 `node-pty` 的 `spawn-helper` 执行位与 `serialport` 的 N-API 绑定；
3. 跑 `npm test`、`npm run typecheck`、`npm run smoke`、`npm run ssh-smoke`、`npm run swap-smoke`；
4. `npm run pack` 后启动打包产物，人工检查五项：输入法、终端字体渲染、剪贴板、钥匙串授权、菜单快捷键；
5. 发 patch 版本，changelog 记一条；失败就回退到上一个 major，不带着问题发版。

ETerm 特有的高风险点（升级时优先验证）：xterm canvas 字形、`eterm-plugin://` 自定义协议、`safeStorage` 钥匙串授权、`Menu` accelerator 与改键联动、`webUtils.getPathForFile` 拖拽路径。另有一条已在 0.9.x 踩到的差异：Electron 的 Node（BoringSSL）不提供原始 `chacha20` cipher，SSH 算法白名单里列出 `chacha20-poly1305@openssh.com` 会在协商前直接报 `Unsupported algorithm`。

## 八、不跟进会怎样

1. **安全**：Chromium CVE 只在受支持的 major 上修；终端工具长期处理不可信远端输出，带已知漏洞的渲染内核风险高于普通工具。
2. **系统兼容**：新 macOS 的窗口、输入法、权限变化通常要新 Electron 才正常。项目已踩过一次：CI 的 arm64 任务不能用 `macos-latest`（指向 macOS 26），只能钉 `macos-15`。
3. **原生模块积压**：拖太久会把多次小升级攒成一次大升级，回归面不可控。

## 九、换壳路径评估

| 方案 | 做法 | 得到的 | 付出的 |
| --- | --- | --- | --- |
| 留在 Electron + 持续升级 | 按第七节节奏跟进 | 生态成熟、修复通道在上游、成本最低 | 包体约 120 MB、内存占用高 |
| Tauri 2 | 前端复用；`src/host` 用 Rust 重写；Node 能力用 sidecar 保留或换 Rust 库（`russh` / `portable-pty`） | 包体降到 ~20 MB 量级、内存下降 | 渲染换 WebKit、CDP 冒烟工具链重做、跨平台三内核不一致 |
| 原生 Swift | AppKit / SwiftUI，自绘终端 | 最好的系统集成与启动速度 | UI 与终端渲染全重写，成本最高 |
| 混合（务实） | 不换壳，把 SSH / PTY 挪进 `utilityProcess` 或 worker | 先解决性能与卡顿 | 不解决包体，架构复杂度上升 |

换壳的前置条件是**先抽 host 适配层**：定义窗口、对话框、剪贴板、钥匙串、菜单、托盘、IPC 的接口，领域层只依赖接口；当前没有这层，所以换壳的真实成本比理论上高一个量级。

判断：**只有「包体 / 内存 / 启动速度」变成硬约束时才启动换壳**；在那之前，季度级升级 Electron 是性价比最高的策略。

## 十、同类工具怎么做

- **Tabby（Electron）**：既跟 Electron 大版本（公开更新日志显示 2025 年内从 29 升到 32），也换过协议库——2024-12 的 v1.0.216 里同时做了两件事：修自己 macOS 权限配置的漏洞 CVE-2024-55950（过度 entitlements 导致 TCC 绕过，与 SSH 库无关），以及把 SSH 后端从 ssh2 换成 russh。公开日志没有把换库原因写成「修该 CVE」。
- **SSHYard（Go 原生）**：公开资料描述为 Go 开发、原生渲染的跨平台 SSH / SFTP 客户端，不走 Electron 路线。它没有 Electron 的上游风险，但继承 Go GUI 工具链与系统渲染层的 bug，属于「换上游」而非「没有上游」。

结论：上游依赖是所有桌面应用的共性问题，差别只在「bug 的形态」和「修复通道在谁手里」。Chromium 高危漏洞通常几天内出补丁，这是留在 Electron 的现实优势。

## 十一、当前缺口与待办

- `electron` 已从 `^45.3.1` 改为 `~45.3.1`（只跟 patch），minor 升级作为显式动作走第七节的五步清单。
- 主进程已补 `render-process-gone` / `did-fail-load` 兜底（可读提示 + 重载）与 `uncaughtException` / `unhandledRejection` 日志；渲染进程崩溃不再表现为黑屏。
- 没有 host 适配层，换壳成本被放大；这是换壳启动前的第一个任务，不换壳则不必做。
- SSH 协议库 `ssh2` 当前为 1.17.0：`npm audit` 无告警，Snyk 对 1.17.0 标「无已知漏洞」，历史上的 Terrapin（CVE-2023-48795）已在 1.15.0 修复、Windows 命令注入（CVE-2020-26301）在 1.4.0 修复。风险不在已知 CVE，而在上游接近停更（Snyk 标 Inactive、单维护者），后续新漏洞与新算法可能得不到支持；需要定期审计并保留换库预案。
- `App.tsx` 里配置存在多份同源状态，属于独立的结构性重构议题，与本篇无关。

## 十二、来源与确定性

- Electron 8 周发布节奏、最近 3 个 major 支持策略：Electron 官方文档（`electron-timelines`、`electron-versioning`）。
- 项目锁定版本、API 使用面、验证基线：以本仓库 `package.json`、`src/host/` 与实际验证记录为准。
- Tabby / SSHYard 的技术路线与升级动作：来自公开更新日志与第三方报道，属于二手信息，未逐一核对上游仓库，引用时请以官方仓库为准。
