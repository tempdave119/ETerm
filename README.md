---
name: "ETerm README"
description: "项目介绍：目标、使用方式与快速上手"
---

# ETerm

## 项目简介

macOS 优先的 SSH / SFTP 工作台：连上机器、在终端里干活、顺手把文件搬来搬去，全部在同一个窗口里完成，不跳设置页。单人自用项目。

## 目标

- 日常七步（找机器、连接、看状态、传文件、开多个终端、调布局、改配置）全程不离开主窗口。
- 当前进度：P0–P4 全部收口；验收反馈第一批已落地（SSH 保活可配、右键粘贴 / 菜单、设置面板版式）。SSH / SFTP / 跳板 / 代理 / 端口转发、六面板与命令、主题、可选组件、dmg 均已交付；后续为日用验收与候选能力。

## 核心功能

- 本地终端：多标签、真彩色、宽字符、输入法、鼠标；右键可配（粘贴 / 右键菜单 / 关闭），⌘C / ⌘V 可用。
- SSH 连接：会话树、密码 / 私钥 / agent、主机指纹确认、断线错误归一、经由跳板机（可链式）、HTTP / SOCKS5 代理（免认证）、可配保活间隔与重试次数。
- 文件面板：远端目录导航、文件只读预览、二进制提示；支持拖拽上传、多文件选择、目录递归下载与拖拽上传。
- 传输队列：上传 / 下载（多文件、目录递归）、进度、取消、失败重试。
- 端口转发：本地 `-L` 与远程 `-R`，按会话管理，关闭会话即释放。
- 可选组件：放进用户数据目录即装载，协议与表单字段由组件 manifest 提供；带串口样例（`examples/components/serial`）。
- 分屏：左右 / 上下分屏，每个 pane 独立会话，最多 4 格；分隔条可拖拽，比例按连接记忆。
- 设置：标签栏齿轮或 ⌘, 打开，字号 / 右键行为 / SSH 保活 / 传输并发 / 界面密度 / 文件面板默认值 / 面板布局即改即生效，可一键恢复默认；面板 600px 两列分组，内容滚动。
- 边界层：会话 / 执行 / 文件 / 传输 / 转发五个资源端口，能力按会话发现。
- 错误态：统一三段式（人话 → 下一步 → 折叠详情），覆盖连接、文件、传输与空态；错误矩阵见 `docs/error-matrix.md`。
- 设计系统：token 清单与控件五态见 `docs/design-tokens.md`。
- 命令面板：⌘K 搜索并执行命令；快捷键与命令面板共用一份命令注册表。
- 系统资源：本机 CPU / 内存 / 负载 / 核数每秒采样，⌘⇧M 或标签栏图标切换。
- 面板布局：会话 / 文件 / 系统资源 / 传输队列可在左 / 右 / 底停靠区之间自由移动，同一区内多个面板可拖分隔改比例，齿轮菜单「上移 / 下移」调区内顺序且比例跟面板走；入口为设置面板「面板布局」分区或面板头部齿轮，位置与比例重启后保持。数据结构与扩展步骤见 `docs/panels.md`。
- 主题：深 / 浅 / 跟随系统三档，设置面板切换即时生效，终端调色板跟随。
- 后续：自动重连；外部主题与多语言文案集中待定。

## 快速上手

```bash
npm install   # postinstall 会补齐 node-pty 的 spawn-helper 执行位
npm run dev
```

窗口打开后点「新建连接」填主机信息，保存并连接后会弹一次主机指纹确认；也可以按 `⌘T` 直接打开本地终端，`⌘K` 打开命令面板，`⌘⇧M` 看本机资源。

可选组件：把 `examples/components/serial` 整个目录复制到 `<用户数据目录>/components/serial`，重启后新建连接里会出现「串口」。完整字段与入口契约见 `docs/components.md`。

## 使用方式

| 命令                | 用途                           |
| ------------------- | ------------------------------ |
| `npm run dev`       | 启动 Vite + Electron           |
| `npm test`          | 跑单元测试（`node --test`）    |
| `npm run typecheck` | 类型检查                       |
| `npm run build`     | 构建到 `dist/`                 |
| `npm run smoke`     | 启动应用、用 CDP 验证终端可用  |
| `npm run ssh-smoke` | 模拟 SSH 主机跑通连接与指纹确认 |
| `npm run pack`      | 构建并打包成 `release/mac/ETerm.app`（不签名） |
| `npm run dist`      | 构建并出 macOS dmg（`release/ETerm-0.1.0.dmg`） |
| `npm run postinstall` | 手动补齐 node-pty spawn-helper 执行位 |

架构与契约见 `_pm/plan/design.md`；分期与进度见 `_pm/track/`。

## 打包

```bash
npm run dist   # 本地出包：release/ETerm-<version>-<arch>.dmg
```

- 发布走 CI：打 `v*` tag 后 GitHub Actions 分别用 `macos-15-intel` 与 `macos-15` 构建 x64 / arm64，并自动创建 Release。
- 未签名（`identity: null`）：首次打开需右键 → 打开，或在「系统设置 → 隐私与安全性」里放行。
- 图标：`assets/icon.svg` 按 macOS 网格（1024 画布 / 824 内容 / 185 圆角）设计，`npm run icon` 生成 `icon.png` 与 16–1024 全套 `icon.icns`；打包经 `mac.icon` 接入，dev 模式用 `app.dock.setIcon` 显示同一图标。
- arm64 产物需在 Apple Silicon 机器上构建；CI 已覆盖双架构，本地构建仅出当前机器架构。
