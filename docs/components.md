---
name: "ETerm 可选组件规范"
description: "F-19 交付物：组件目录、manifest 字段、入口契约与串口样例说明"
---

# ETerm 可选组件规范

> 可选组件是外挂能力包：设置「扩展」里可安装随包示例，或手动放进用户数据目录；宿主不为某个组件改代码。首版只支持 CJS 入口。

## 目录与装载

```
<用户数据目录>/components/<组件 id>/
  manifest.json   组件描述与界面字段
  index.cjs       能力模块入口（CommonJS）
```

- macOS 开发环境：`~/Library/Application Support/ETerm/components/`；冒烟用临时目录。
- 启动时扫描一次；单个组件坏掉只记日志并跳过，不影响宿主启动。
- 组件在内置模块之后装载，`setup()` 在宿主服务注入之后执行；但宿主服务不对模块开放，`ctx.get()` 只能取其他模块导出的、且已在 `consumes` 里声明的服务。

## 安装方式

- 0.5 起：设置 →「扩展」→「安装示例组件」，宿主会把应用资源里的 `serial` / `telnet` 复制到 `<用户数据目录>/components/`；安装后需要重启应用才会注册协议。
- 手动安装仍然可用：把组件目录放进 `<用户数据目录>/components/<组件 id>/`，重启应用。
- 组件内部需要宿主已有依赖（如 `serialport`）时，宿主会把应用的 `node_modules` 加入模块搜索路径；第三方组件应优先复用宿主依赖，不要自行携带原生模块。
- 示例组件随应用资源提供（electron-builder `extraResources`）；设置页只做复制，不热加载，也不覆盖用户已改过的同名目录。
- 新连接表单在没有任何外挂组件时会提示去「扩展」安装。

## manifest.json

```json
{
  "id": "serial",
  "kind": "capability",
  "apiVersion": "^1.0.0",
  "entry": "index.cjs",
  "activation": { "onProtocol": "serial" },
  "ui": {
    "label": "串口",
    "fields": [
      { "key": "path", "label": "设备", "type": "select", "optionsSource": "serial-devices", "required": true },
      { "key": "baudRate", "label": "波特率", "type": "select", "options": ["9600", "115200"], "default": "115200" },
      { "key": "dtr", "label": "DTR", "type": "boolean", "default": "true" }
    ]
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 组件唯一 id，与模块导出的 `id` 一致 |
| `kind` | 目前只接受 `capability`；`panel` / `theme` / `command` 为预留，未实现，写入即被拒绝 |
| `apiVersion` | `^1.0.0` 形式，只校验主版本 |
| `entry` | 相对组件目录的入口文件，必须在目录内 |
| `activation.onProtocol` | 协议名（1–32 位小写），新建连接的下拉里出现 |
| `ui.label` | 下拉显示名 |
| `ui.fields` | 连接表单字段，最多 10 个；类型 text / select / number / boolean |

字段项：`key`、`label`、`type`、`placeholder`、`options`、`optionsSource`、`default`、`required`。宿主只负责渲染、保存与透传，不解释含义。

动态选项：`optionsSource: "serial-devices"` 时，下拉选项改由宿主枚举（macOS 为 `/dev/cu.*`，没有同名 cu 时补 `tty.*`），并在下拉旁提供刷新按钮；`boolean` 渲染为复选框，写入 `"true"` / `"false"` 字符串。

## 入口契约

入口导出能力模块，形如 `src/core/manifest.ts` 的 `CapabilityModule`：

```js
module.exports = {
  id: 'serial',
  kind: 'capability',
  builtin: false,
  apiVersion: '^1.0.0',
  provides: ['session'],
  activation: { onProtocol: 'serial' },
  setup() {
    return {
      exports: {
        openSession(options) {
          // options.target 是连接里保存的 options 原样透传
          return { session: { write, resize, close, onData, onExit } };
        },
      },
      dispose() {},
    };
  },
};
```

- `provides` 至少包含 `session`；需要文件 / 传输 / 转发时再声明对应端口。
- 模块由宿主注册表校验：id 唯一、协议未被占用、apiVersion 主版本匹配。
- 会话端口必须实现 `src/core/ports.ts` 的 `SessionPort`。

## 服务权限

- 组件拿不到宿主的 `connections` / `credentials` / `knownHosts` / `layouts`：`ctx.get()` 先看 `consumes` 声明，宿主服务一律拒绝。
- 凭据由宿主在 `openSession` 前组装进 `target`，组件只收到本次连接的一份；读不到凭据库，也拿不到其他连接的凭据。
- 组件之间要复用服务时，由提供方在 `exports.services` 导出，消费方在模块对象的 `consumes` 字段声明。
- 组件报错可以抛 `{ code, message?, next?, detail?, host?, port? }` 形状的对象，宿主按产品码识别；不要依赖 `ProductError` 类实例跨 bundle 共享。
- 安装即信任：组件在主进程内运行，无签名、无沙箱、无市场；不要装来路不明的组件。

## Telnet 样例

`examples/components/telnet/` 是第二个外挂能力包样例：

- 把整个目录复制到 `<用户数据目录>/components/telnet`，重启后新建连接的协议下拉出现「Telnet」。
- 表单字段：`host`（主机）与 `port`（端口，默认 23）；连接记录把两项存在 `options` 里，宿主不解释。
- 最小 Telnet 协商：主动声明 TTYPE / NAWS / SGA，按服务端 DO / WILL 回应；剥离 IAC 协商字节后交给 xterm；TTYPE 回 `xterm-256color`，窗口变化发 NAWS，回车按 NVT 发 CR LF。
- 限制：明文协议，不做 Telnet 认证与加密，只适合可信网络；不实现行模式 / LINEMODE。
- 验证：`tests/modules/telnet-protocol.test.ts`（IAC / NAWS / TTYPE / 数据剥离）、`tests/modules/telnet-session.test.ts`（真实 TCP 会话）；`npm run ssh-smoke` 用 mock Telnet 服务器验证 banner、回显、NAWS 与 TTYPE。

## 串口样例

`examples/components/serial/` 是随仓库提供的样例：

- 直接打开设备文件做原始读写；`baudRate` 只保存不生效（设置波特率需要平台 ioctl，首版不引原生依赖）。
- 适合验证装载链路与 115200 默认速率的设备；真实串口建议后续换 `serialport` 实现。
- 装载后新建连接出现「串口」，填设备路径即可开会话。

## 验证

- 单测：`tests/host/components.test.ts`（manifest 校验、坏组件跳过、示例装载）。
- 端到端：`npm run ssh-smoke` 把样例复制进临时 userData，用 PTY 模拟串口设备，验证双向收发（截图 `tmp/ssh-smoke-serial.png`）。
