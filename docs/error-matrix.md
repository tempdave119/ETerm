---
name: "ETerm 错误矩阵"
description: "F-13.1 交付物：7 个产品错误码 + INTERNAL 的人话、下一步、详情来源与触发场景；归一顺序与界面呈现位置"
---

# ETerm 错误矩阵

> 错误码是界面文案的唯一来源，定义在 `src/core/errors.ts`。新增或改文案只改那里，并同步本表与 `tests/core/errors.test.ts`。

## 通用规则

- 界面只展示三段式：人话（message）→ 下一步（next）→ 折叠详情（detail）。原始英文错误只允许出现在折叠详情里。
- 同一个码在不同场景下的下一步不同时，用 `ProductError` 的 `next` 覆盖（例如首次确认指纹 vs 指纹变化、缺少 SFTP vs 会话已关闭）。
- 取消不是错误：传输取消走 `status: canceled`，不产生错误块，行上给「重试」。
- 归一顺序（`normalizeError`）：已是 `ProductError` 原样返回 → ssh2 `level` → Node `code` → SFTP 状态码 → 文案正则 → `INTERNAL` 兜底。

## 产品错误码（7 + INTERNAL）

| code | 人话 message | 下一步 next | detail 来源 | 触发场景 |
| ---- | ------------ | ----------- | ----------- | -------- |
| `AUTH_FAILED` | 认证失败：用户名、密码或私钥不匹配 | 核对用户名与密码 / 私钥后重试 | ssh2 原始错误；解析连接时为私钥路径或连接 id | 密码或用户名错误、私钥/口令不匹配、认证方式全部失败 |
| `HOST_UNREACHABLE` | 连不上主机：网络不通或端口未开放 | 确认主机地址与端口，再试一次 | 原始错误 message（含 host:port） | 端口拒绝、域名解析失败、网络不可达、连接被重置、SFTP 状态 6 / 7 |
| `HOST_KEY_CHANGED` | 主机指纹变了，可能是重装或劫持 | 确认主机身份后再决定是否继续 | 观察到的主机指纹 | 首次连接无指纹（message 覆盖为「首次连接需要确认主机指纹」）；指纹与 known_hosts 不一致 |
| `TIMEOUT` | 超时：服务器无响应 | 检查网络后重试 | 原始错误 message | 握手超时、`ETIMEDOUT`、ssh2 `client-timeout` |
| `PERMISSION_DENIED` | 权限不足：这个操作被拒绝 | 换有权限的账号，或调整目标文件权限 | 远端路径 + 原始错误 message | 远端文件无权限（SFTP 3）、本地 `EACCES` / `EPERM` |
| `FILE_NOT_FOUND` | 文件不存在 | 刷新目录后重新选择 | 远端或本地路径 + 原始错误 message | 文件被删除、路径写错（`ENOENT`、SFTP 2） |
| `UNSUPPORTED` | 当前会话不支持这个操作 | 换一个支持该操作的连接 | 会话 id 或原始错误 message | 协议模块缺失、主机未开启 SFTP（文件面板 / 传输）、会话已关闭、SFTP 状态 8 |
| `INTERNAL` | 操作没有完成 | 重试一次；仍然失败请查看详情 | 原始错误 message | 未分类异常（含 SFTP 状态 1 / 4 / 5）、连接记录不存在或配置不完整 |

## 场景级文案覆盖

这些场景沿用上面的 code，但 message / next 由调用点覆盖，保证「下一步」说得出口：

| 场景 | code | message | next |
| ---- | ---- | ------- | ---- |
| 首次连接确认指纹 | `HOST_KEY_CHANGED` | 首次连接需要确认主机指纹 | 沿用默认 |
| 连接没有保存密码 | `AUTH_FAILED` | 这个连接还没有保存密码 | 编辑连接，补上密码后再连 |
| 连接没有选择私钥 | `AUTH_FAILED` | 这个连接还没有选择私钥 | 编辑连接，选择私钥文件后再连 |
| 没有 SSH agent | `AUTH_FAILED` | 没有可用的 SSH agent | 启动 ssh-agent，或改用密码 / 私钥 |
| 私钥不是绝对路径 | `AUTH_FAILED` | 私钥路径必须是绝对路径 | 改成以 / 开头的绝对路径 |
| 私钥读取失败 | `AUTH_FAILED` | 私钥文件读取失败 | 确认文件路径与权限后重试 |
| 主机没有 SFTP | `UNSUPPORTED` | 这台主机没有开启 SFTP，文件面板不可用 / 无法传文件 | 终端仍可正常使用；需要文件操作请换一台主机 |
| 会话已关闭 | `UNSUPPORTED` | 会话已关闭，操作没有完成 | 重新打开这个连接后再试 |
| 队列启动时会话已关闭 | `UNSUPPORTED` | 会话已关闭，传输没有完成 | 重新打开连接后再传 |

## 归一来源表

| 来源 | 映射 |
| ---- | ---- |
| ssh2 `level` | `client-authentication` → AUTH_FAILED；`client-timeout` → TIMEOUT；`client-connection` / `client-socket` → HOST_UNREACHABLE |
| Node `code` | `ECONNREFUSED` / `EHOSTUNREACH` / `ENETUNREACH` / `EAI_AGAIN` / `ENOTFOUND` / `ECONNRESET` / `ECONNABORTED` / `EPIPE` → HOST_UNREACHABLE；`ETIMEDOUT` → TIMEOUT；`EACCES` / `EPERM` → PERMISSION_DENIED；`ENOENT` → FILE_NOT_FOUND |
| SFTP 状态码（数字） | 2 → FILE_NOT_FOUND；3 → PERMISSION_DENIED；6 / 7 → HOST_UNREACHABLE；8 → UNSUPPORTED；其余进兜底 |
| 文案正则 | 认证失败、主机指纹、私钥/口令、超时、文件不存在、权限不足、连接断开（not connected / connection lost / socket hang up / broken pipe） |
| 兜底 | 其余全部 `INTERNAL`，原始 message 进 detail |

## 界面呈现位置

| 位置 | 组件 | 说明 |
| ---- | ---- | ---- |
| 错误条 | `App` + `ErrorMessage` | 有标签时出现在工作区顶部，可关闭 |
| 空态 | `EmptyState` + `ErrorMessage` | 没有标签时错误直接落在空态里，不重复显示错误条 |
| 文件面板 | `FilePanel` + `ErrorMessage` | 列目录 / 上传下载入口失败；预览失败在弹窗里用同一组件 |
| 传输行 | `TransferPanel` + `ErrorMessage` | 失败任务在行下方展开三段式；成功 / 取消不显示错误块 |
| 指纹弹窗 | `HostKeyDialog` | `HOST_KEY_CHANGED` 且能解析出指纹时改用弹窗确认，不显示错误条 |

## 验证

- 单测：`tests/core/errors.test.ts`（码默认值、覆盖 next、Node / SFTP / 文案归一）、`tests/host/session-capability.test.ts`、`tests/services/transfers.test.ts`、`tests/modules/ssh-sftp.test.ts`。
- 错误矩阵端到端：`npm run ssh-smoke` 覆盖错主机、认证失败、错指纹、文件不存在、取消传输、无 SFTP 降级，截图 `tmp/error-*.png`。
- 认证失败一项在自动化里用「服务器拒绝密钥」触发（与错误密码同一条 ssh2 `client-authentication` 归一分支）：开发版未签名，调用 `safeStorage` 保存密码会弹系统钥匙串授权框并阻塞无人值守运行；密码保存链路需在已授权钥匙串的日常环境手动验证。
