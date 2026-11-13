---
name: "ETerm README"
description: "项目介绍：目标、使用方式与快速上手"
---

# ETerm

## 项目简介

macOS 优先的 SSH / SFTP 工作台：连上机器、在终端里干活、顺手把文件搬来搬去，全部在同一个窗口里完成，不跳设置页。单人自用项目。

## 目标

- 日常七步（找机器、连接、看状态、传文件、开多个终端、调布局、改配置）全程不离开主窗口。
- 当前进度：P0 骨架跑通，只有本地终端；SSH / SFTP 在 P1。

## 核心功能

- 本地终端：多标签、真彩色、宽字符、输入法、鼠标。
- 边界层：会话 / 执行 / 文件 / 传输四个资源端口，能力按会话发现。
- 后续：SSH 与 SFTP、传输队列、分屏与布局、配置热生效、设计系统、主题。

## 快速上手

```bash
npm install   # postinstall 会补齐 node-pty 的 spawn-helper 执行位
npm run dev
```

窗口打开后点「新建终端」或按 `⌘T`，即可在本地 shell 里执行命令。

## 使用方式

| 命令                | 用途                           |
| ------------------- | ------------------------------ |
| `npm run dev`       | 启动 Vite + Electron           |
| `npm test`          | 跑单元测试（`node --test`）    |
| `npm run typecheck` | 类型检查                       |
| `npm run build`     | 构建到 `dist/`                 |
| `npm run smoke`     | 启动应用、用 CDP 验证终端可用  |
| `npm run postinstall` | 手动补齐 node-pty spawn-helper 执行位 |

架构与契约见 `_pm/plan/design.md`；分期与进度见 `_pm/track/`。
