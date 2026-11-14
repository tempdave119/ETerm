import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import electronPath from 'electron';

const DEBUG_PORT = 9333;
const MARKER = 'eterm-smoke-ok';
const SCREENSHOT = 'tmp/p0-smoke.png';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`))));
  });
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`等待超时：${label}${lastError ? `（${lastError.message}）` : ''}`);
}

function setInputScript(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

function setSelectScript(selector, value) {
  return `(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

function createClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')));
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

await run(process.execPath, ['scripts/build-main.mjs']);
await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);

// 每轮用独立数据目录：配置与布局从上一次跑剩的值会干扰断言。
const dataDir = join(process.cwd(), 'tmp', 'smoke', randomUUID());
mkdirSync(dataDir, { recursive: true });

// 外部主题：一份合法、一份带未知 token；后者应被跳过且不出现在下拉里。
mkdirSync(join(dataDir, 'themes'), { recursive: true });
writeFileSync(
  join(dataDir, 'themes', 'nord.json'),
  JSON.stringify({
    id: 'nord',
    name: 'Nord Smoke',
    base: 'dark',
    ui: { '--bg-canvas': '#101820', '--text-primary': '#e5e9f0' },
    terminal: { background: '#101820', foreground: '#e5e9f0' },
  }),
);
writeFileSync(
  join(dataDir, 'themes', 'broken.json'),
  JSON.stringify({ id: 'broken', name: 'Broken', base: 'dark', ui: { '--font-body': '13px' } }),
);

const appLogs = [];
const app = spawn(electronPath, ['.', `--remote-debugging-port=${DEBUG_PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ETERM_SMOKE: '1', ETERM_USER_DATA: dataDir },
});
// 主进程日志既转发到终端，也留一份用于断言（菜单与托盘装配证据）。
for (const stream of [app.stdout, app.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    appLogs.push(chunk);
    process.stdout.write(chunk);
  });
}

let client;

try {
  const target = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === 'page');
    },
    20_000,
    'CDP 页面目标',
  );

  client = createClient(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  // 窗口不在前台时 CDP 的键盘事件会被丢弃，先置前。
  await client.send('Page.bringToFront');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  await waitFor(() => evaluate(`typeof window.eterm === 'object'`), 15_000, 'preload 注入');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="new-terminal"]') !== null`),
    10_000,
    '空态渲染',
  );

  // 首次启动引导：只展示一次；关闭后写 onboarded 标记，下次启动回简洁空态。
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="onboarding-guide"]') !== null`),
    5_000,
    '首次启动引导',
  );
  await evaluate(`document.querySelector('[data-testid="guide-dismiss"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="onboarding-guide"]') === null`),
    5_000,
    '关闭首次启动引导',
  );
  await waitFor(
    async () => {
      try {
        const raw = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
        return raw.config?.ui?.onboarded === true;
      } catch {
        return false;
      }
    },
    5_000,
    '引导标记落盘',
  );

  await evaluate(`document.querySelector('[data-testid="new-terminal"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('.xterm-helper-textarea') !== null`),
    10_000,
    '终端挂载',
  );

  const sessionId = await waitFor(
    () => evaluate(`document.querySelector('.terminal-host')?.dataset.sessionId ?? ''`),
    5_000,
    '会话 id',
  );
  await waitFor(() => evaluate(`typeof window.__etermDebug === 'object'`), 5_000, '调试桥');
  // 等 shell 打印首个 prompt：过早输入会让 zsh 把 prompt 与回显顺序打乱。
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).trim().length > 0,
    10_000,
    '首个 prompt',
  );

  // 走 xterm 自己的 input()，与键盘输入同一条通路；CDP 的键盘事件在窗口未激活时不会送达。
  const command = `cd '${process.cwd()}' && echo ${MARKER} && ls`;
  const typed = await evaluate(
    `window.__etermDebug.type(${JSON.stringify(sessionId)}, ${JSON.stringify(`${command}\r`)})`,
  );
  if (!typed) throw new Error('会话已关闭，无法输入');

  const screen = await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
      const occurrences = (text.match(new RegExp(MARKER, 'g')) ?? []).length;
      // 默认窗口变窄后命令回显可能跨行，marker 只保证输出里出现一次即可。
      return occurrences >= 1 && text.includes('package.json') ? text : '';
    },
    10_000,
    '命令输出回显',
  );

  // 宽字符：中文必须原样落在缓冲区里，宽度算错会把后续内容挤歪。
  await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, "echo 中文-宽字符\\r")`);
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
      return (text.match(/中文-宽字符/g) ?? []).length >= 2;
    },
    8_000,
    '宽字符回显',
  );

  // 真彩色：24 位色序列必须能被 xterm 直接渲染（截图可见红色）。
  const colorCommand = "printf '\\033[38;2;255;0;0mRGB-TRUE-COLOR\\033[0m\\n'\r";
  await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, ${JSON.stringify(colorCommand)})`);
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).includes('RGB-TRUE-COLOR'),
    8_000,
    '真彩色输出',
  );

  // 右键粘贴：默认 rightClick=paste，剪贴板经主进程白名单通道送到 xterm。
  await evaluate(`window.eterm.writeClipboard('echo right-click-ok')`);
  const contextMenuDispatched = await evaluate(`(() => {
    const host = document.querySelector('.pane[data-active="true"] .terminal-host');
    host?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
    return Boolean(host);
  })()`);
  if (!contextMenuDispatched) throw new Error('找不到终端 host，无法触发右键');
  await waitFor(
    async () =>
      String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).includes('echo right-click-ok'),
    5_000,
    '右键粘贴文本',
  );
  await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, "\\r")`);
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
      return (text.match(/right-click-ok/g) ?? []).length === 2;
    },
    8_000,
    '右键粘贴执行',
  );

  // 行号与时间戳：默认开启；行号递增、时间格式合法（折行行时间留空）。
  await waitFor(
    () => evaluate(`document.querySelectorAll('.terminal-gutter__num').length > 0`),
    5_000,
    '终端 gutter 渲染',
  );
  const gutter = await evaluate(`(() => {
    const nums = [...document.querySelectorAll('.terminal-gutter__num')].map((el) => Number(el.textContent));
    const times = [...document.querySelectorAll('.terminal-gutter__time')].map((el) => el.textContent ?? '');
    return { first: nums[0], last: nums[nums.length - 1], count: nums.length, times };
  })()`);
  if (!(gutter.count > 0) || !(gutter.last > gutter.first)) throw new Error('行号未递增或为空');
  if (!gutter.times.every((text) => text === '' || /^\[\d{2}:\d{2}:\d{2}\]$/.test(text))) {
    throw new Error(`时间格式不正确：${JSON.stringify(gutter.times.slice(0, 3))}`);
  }

  // 终端内搜索：⌘F 打开搜索条，输入后跳转，关闭后终端仍可正常输入。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="terminal-find"]') !== null`),
    5_000,
    '打开终端搜索',
  );
  await evaluate(setInputScript('[data-testid="terminal-find-input"]', MARKER));
  await evaluate(`document.querySelector('[data-testid="terminal-find-next"]').click()`);
  await evaluate(`document.querySelector('[data-testid="terminal-find-close"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="terminal-find"]') === null`),
    5_000,
    '关闭终端搜索',
  );
  await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, "echo find-after-close-ok\\r")`);
  await waitFor(
    async () =>
      String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).includes(
        'find-after-close-ok',
      ),
    8_000,
    '搜索关闭后终端可用',
  );

  // 缩放：视口变化后 xterm 列数必须跟着变，否则界面与 PTY 尺寸不同步。
  const beforeSize = await evaluate(`JSON.stringify(window.__etermDebug.size(${JSON.stringify(sessionId)}))`);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    async () => {
      const size = await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`);
      return size !== null && size.cols < JSON.parse(beforeSize).cols;
    },
    5_000,
    '缩放后列数更新',
  );
  await client.send('Emulation.clearDeviceMetricsOverride');

  // 第二个标签：新建、切换、关闭都要动到真实会话。
  await evaluate(`document.querySelector('.tabbar__new').click()`);
  const sessionIds = await waitFor(
    async () => {
      const ids = await evaluate(
        `[...document.querySelectorAll('.terminal-host')].map((element) => element.dataset.sessionId)`,
      );
      return ids.length >= 2 ? ids : null;
    },
    8_000,
    '第二个终端',
  );
  const secondId = sessionIds[1];
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(secondId)})`)).trim().length > 0,
    10_000,
    '第二个 prompt',
  );
  await evaluate(`window.__etermDebug.type(${JSON.stringify(secondId)}, "echo ${MARKER}-tab2\\r")`);
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(secondId)})`));
      return (text.match(new RegExp(`${MARKER}-tab2`, 'g')) ?? []).length === 2;
    },
    8_000,
    '第二个终端输出',
  );

  await evaluate(`document.querySelectorAll('.tab__label')[0].click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.pane[data-active="true"] .terminal-host')?.dataset.sessionId === ${JSON.stringify(sessionId)}`,
      ),
    3_000,
    '切回第一个标签',
  );
  const firstScreen = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
  if (!firstScreen.includes('package.json')) throw new Error('切回后第一个终端内容丢失');

  // 命令注册表的快捷键通路：⌘⇧] / ⌘⇧[ 切换标签。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight', key: ']', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.pane[data-active="true"] .terminal-host')?.dataset.sessionId === ${JSON.stringify(secondId)}`,
      ),
    3_000,
    '⌘⇧] 切换标签',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketLeft', key: '[', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.pane[data-active="true"] .terminal-host')?.dataset.sessionId === ${JSON.stringify(sessionId)}`,
      ),
    3_000,
    '⌘⇧[ 切回标签',
  );

  await evaluate(`document.querySelectorAll('.tab__close')[1].click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.terminal-host').length === 1`), 5_000, '关闭第二个标签');

  // ⌘K 命令面板：搜索「设置」并执行，设置面板随之打开。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="command-palette"]') !== null`),
    5_000,
    '命令面板',
  );
  const paletteShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/palette-smoke.png', Buffer.from(paletteShot.data, 'base64'));
  await evaluate(setInputScript('#command-query', '设置'));
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="command-settings.open"]') !== null`),
    5_000,
    '命令过滤',
  );
  await evaluate(`document.querySelector('[data-testid="command-settings.open"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') !== null`),
    5_000,
    '命令打开设置',
  );
  await evaluate(`document.querySelector('[data-testid="settings-cancel"]').click()`);

  // 设置：左侧分类导航；config 走草稿（即时预览、取消回滚、保存才落盘），layout 即时。
  const colsAtDefaultFont = (await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`)).cols;
  const readConfig = () =>
    evaluate(`window.eterm.getConfig().then((result) => (result.ok ? result.value : null))`);
  const openSettings = async () => {
    await evaluate(`document.querySelector('[data-testid="open-settings"]').click()`);
    await waitFor(
      () => evaluate(`document.querySelector('[data-testid="settings-panel"]') !== null`),
      5_000,
      '设置面板',
    );
  };
  const sectionMarkers = {
    appearance: '#settings-theme',
    terminal: '#settings-font-size',
    connection: '#settings-keepalive',
    extensions: '[data-testid="component-sample-telnet"]',
    transfer: '[data-testid="settings-files-default"]',
    shortcuts: '[data-testid="shortcut-row-terminal.new"]',
    layout: '[data-testid="settings-dock-size-left"]',
  };
  const openSection = async (section) => {
    await evaluate(`document.querySelector('[data-testid="settings-nav-${section}"]').click()`);
    await waitFor(
      () => evaluate(`document.querySelector(${JSON.stringify(sectionMarkers[section])}) !== null`),
      5_000,
      `设置分类 ${section}`,
    );
  };
  await openSettings();
  const settingsWidth = await evaluate(
    `document.querySelector('[data-testid="settings-panel"]')?.getBoundingClientRect().width ?? 0`,
  );
  if (settingsWidth < 710) throw new Error(`设置面板宽度不足：${settingsWidth}`);
  const navCount = await evaluate(`document.querySelectorAll('.settings-nav__item').length`);
  if (navCount !== 7) throw new Error(`设置分类应为 7 个，实际 ${navCount}`);

  await openSection('terminal');
  await evaluate(setSelectScript('#settings-font-size', '18'));
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`)).cols < colsAtDefaultFont,
    5_000,
    '字号草稿预览',
  );

  // 外观草稿预览：字体 / 行高 / 光标即时作用；行高变化会改变终端行数。
  const rowsAtFont18 = (await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`)).rows;
  await evaluate(setSelectScript('#settings-font-family', 'menlo'));
  await evaluate(setSelectScript('#settings-cursor-style', 'bar'));
  await evaluate(`document.querySelector('[data-testid="settings-cursor-blink"]').click()`);
  await evaluate(setInputScript('[data-testid="settings-line-height"]', '1.35'));
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`)).rows < rowsAtFont18,
    5_000,
    '行高草稿预览',
  );

  // 行号 / 时间戳开关：草稿即时生效，全部关闭后 gutter 消失。
  await evaluate(`document.querySelector('[data-testid="settings-line-numbers"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('.terminal-gutter__num').length === 0`),
    5_000,
    '关闭行号',
  );
  await evaluate(`document.querySelector('[data-testid="settings-timestamps"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="terminal-gutter"]') === null`),
    5_000,
    '关闭时间戳后 gutter 消失',
  );
  await evaluate(`document.querySelector('[data-testid="settings-timestamps"]').click()`);
  await evaluate(`document.querySelector('[data-testid="settings-line-numbers"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('.terminal-gutter__num').length > 0`),
    5_000,
    '重新打开行号',
  );

  await openSection('appearance');
  await evaluate(setSelectScript('#settings-density', 'compact'));
  await waitFor(
    () => evaluate(`document.querySelector('.app')?.dataset.density === 'compact'`),
    5_000,
    '密度草稿预览',
  );

  await evaluate(setSelectScript('#settings-theme', 'light'));
  await waitFor(
    () =>
      evaluate(
        `document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 248)'`,
      ),
    5_000,
    '主题草稿预览',
  );
  const previewConfig = await readConfig();
  if (previewConfig?.terminal.fontSize !== 13 || previewConfig?.ui.density !== 'comfortable') {
    throw new Error('草稿预览不应写入磁盘');
  }
  const themeShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/theme-light-smoke.png', Buffer.from(themeShot.data, 'base64'));

  // 外部主题：合法文件出现在下拉、坏文件被跳过；切回内置时 inline 覆盖要清空。
  await waitFor(
    () => evaluate(`document.querySelector('#settings-theme option[value="ext:nord"]') !== null`),
    5_000,
    '外部主题出现在下拉',
  );
  const brokenThemeVisible = await evaluate(
    `document.querySelector('#settings-theme option[value="ext:broken"]') !== null`,
  );
  if (brokenThemeVisible) throw new Error('非法主题不应出现在下拉里');
  await evaluate(setSelectScript('#settings-theme', 'ext:nord'));
  await waitFor(
    () =>
      evaluate(
        `document.documentElement.dataset.theme === 'dark' && document.documentElement.style.getPropertyValue('--bg-canvas').trim() === '#101820'`,
      ),
    5_000,
    '外部主题生效',
  );
  const externalShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/theme-external-smoke.png', Buffer.from(externalShot.data, 'base64'));
  await evaluate(setSelectScript('#settings-theme', 'light'));
  await waitFor(
    () =>
      evaluate(
        `document.documentElement.dataset.theme === 'light' && document.documentElement.style.getPropertyValue('--bg-canvas') === ''`,
      ),
    5_000,
    '切回内置主题清理覆盖',
  );

  // 能力包：示例组件默认未安装；一键安装后状态变化并落到临时 userData。
  await openSection('extensions');
  const beforeInstall = await evaluate(
    `document.querySelector('[data-testid="component-sample-telnet"]')?.dataset.installed`,
  );
  if (beforeInstall !== 'false') throw new Error(`示例组件初始状态异常：${beforeInstall}`);
  await evaluate(`document.querySelector('[data-testid="components-install"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('[data-testid="component-sample-telnet"]')?.dataset.installed === 'true'`,
      ),
    10_000,
    '安装示例组件',
  );
  const installedManifest = await readFile(join(dataDir, 'components', 'telnet', 'manifest.json'), 'utf8');
  if (!installedManifest.includes('"telnet"')) throw new Error('Telnet 示例组件未落到 userData');

  // 卸载：二次确认后删除 userData 目录；重启后才会从已加载组件里消失。
  await evaluate(`document.querySelector('[data-testid="component-uninstall-telnet"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('[data-testid="component-uninstall-telnet"]')?.textContent?.includes('确认卸载')`,
      ),
    5_000,
    '卸载二次确认',
  );
  await evaluate(`document.querySelector('[data-testid="component-uninstall-telnet"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('[data-testid="component-sample-telnet"]')?.dataset.installed === 'false'`,
      ),
    10_000,
    '卸载示例组件',
  );
  let telnetRemoved = false;
  try {
    await stat(join(dataDir, 'components', 'telnet'));
  } catch {
    telnetRemoved = true;
  }
  if (!telnetRemoved) throw new Error('卸载后 Telnet 组件目录仍存在');

  // 卸载后单行重装：目录被删掉也能从随包示例复制回来，形成卸载/安装闭环。
  await evaluate(`document.querySelector('[data-testid="component-install-telnet"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('[data-testid="component-sample-telnet"]')?.dataset.installed === 'true'`,
      ),
    10_000,
    '重新安装示例组件',
  );

  // 取消：草稿丢弃，界面回到已保存值。
  await evaluate(`document.querySelector('[data-testid="settings-cancel"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '取消关闭设置',
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.app')?.dataset.density === 'comfortable' && document.documentElement.dataset.theme === (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`,
      ),
    5_000,
    '取消回滚外观',
  );
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.size(${JSON.stringify(sessionId)})`)).cols === colsAtDefaultFont,
    5_000,
    '取消回滚字号',
  );

  // 保存：真正写盘。
  await openSettings();
  await openSection('terminal');
  await evaluate(setSelectScript('#settings-font-size', '18'));
  await evaluate(setSelectScript('#settings-font-family', 'menlo'));
  await evaluate(setSelectScript('#settings-cursor-style', 'bar'));
  await evaluate(`document.querySelector('[data-testid="settings-cursor-blink"]').click()`);
  await evaluate(setInputScript('[data-testid="settings-line-height"]', '1.35'));
  await evaluate(setSelectScript('#settings-scrollback', '10000'));
  await evaluate(setSelectScript('#settings-right-click', 'menu'));
  await openSection('appearance');
  await evaluate(setSelectScript('#settings-density', 'compact'));
  await evaluate(setSelectScript('#settings-theme', 'light'));
  await openSection('connection');
  await evaluate(setSelectScript('#settings-keepalive', '60'));
  await openSection('transfer');
  await evaluate(`document.querySelector('[data-testid="settings-files-default"]').click()`);
  const settingsShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/settings-smoke.png', Buffer.from(settingsShot.data, 'base64'));
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '保存后关闭设置',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="toast"]')?.textContent === '设置已保存'`),
    5_000,
    '保存提示',
  );
  await waitFor(
    async () => {
      const config = await readConfig();
      return (
        config?.terminal.fontSize === 18 &&
        config?.terminal.fontFamily === 'menlo' &&
        config?.terminal.lineHeight === 1.35 &&
        config?.terminal.cursorStyle === 'bar' &&
        config?.terminal.cursorBlink === false &&
        config?.terminal.scrollback === 10000 &&
        config?.terminal.rightClick === 'menu' &&
        config?.ui.density === 'compact' &&
        config?.ui.theme === 'light' &&
        config?.ssh.keepaliveInterval === 60 &&
        config?.files.openByDefault === false
      );
    },
    5_000,
    '设置写入磁盘',
  );

  // 重开保持。
  await openSettings();
  await openSection('terminal');
  await waitFor(
    () => evaluate(`document.querySelector('#settings-font-size')?.value === '18'`),
    5_000,
    '设置重开后保持',
  );
  const keptFont = await evaluate(`document.querySelector('#settings-font-family')?.value`);
  if (keptFont !== 'menlo') throw new Error(`重开后字体应保持 menlo，实际 ${keptFont}`);

  // 恢复默认设置：二次点击确认，改的是草稿，保存才落盘。
  await evaluate(`document.querySelector('[data-testid="settings-reset"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-reset"]')?.textContent === '再点一次确认'`),
    5_000,
    '恢复默认确认态',
  );
  await evaluate(`document.querySelector('[data-testid="settings-reset"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('#settings-font-size')?.value === '13'`),
    5_000,
    '恢复默认设置进草稿',
  );
  if ((await readConfig()).terminal.fontSize !== 18) throw new Error('恢复默认在保存前不应落盘');
  // 布局即时：改左栏 260，再恢复默认布局（二次点击即时生效，不进草稿）。
  await openSection('layout');
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="settings-dock-size-left"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '260');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(
    async () =>
      (await evaluate(
        `window.eterm.getPanelLayout().then((result) => (result.ok ? result.value.sizes.left : null))`,
      )) === 260,
    5_000,
    '设置面板调整左栏',
  );
  await evaluate(`document.querySelector('[data-testid="settings-reset-layout"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-reset-layout"]')?.textContent === '再点一次确认'`),
    5_000,
    '恢复默认布局确认态',
  );
  await evaluate(`document.querySelector('[data-testid="settings-reset-layout"]').click()`);
  await waitFor(
    async () =>
      (await evaluate(
        `window.eterm.getPanelLayout().then((result) => (result.ok ? result.value.sizes.left : null))`,
      )) === 220,
    5_000,
    '恢复默认布局',
  );
  const settingsDockShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/settings-dock-size.png', Buffer.from(settingsDockShot.data, 'base64'));

  // 快捷键：改「切换系统资源面板」为 ⌘⇧J；冲突阻止保存，解绑后恢复。
  await openSection('shortcuts');
  await evaluate(`document.querySelector('[data-testid="shortcut-edit-panel.monitor"]').click()`);
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="shortcut-edit-panel.monitor"]')?.textContent === '⌘⇧J'`),
    5_000,
    '快捷键录制',
  );

  await evaluate(`document.querySelector('[data-testid="shortcut-edit-tab.next"]').click()`);
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="shortcut-conflict"]') !== null`),
    5_000,
    '快捷键冲突提示',
  );
  if ((await evaluate(`document.querySelector('[data-testid="settings-save"]').disabled`)) !== true) {
    throw new Error('冲突未阻止保存');
  }
  const shortcutShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/shortcut-smoke.png', Buffer.from(shortcutShot.data, 'base64'));
  await evaluate(`document.querySelector('[data-testid="shortcut-clear-tab.next"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="shortcut-conflict"]') === null`),
    5_000,
    '解绑后冲突解除',
  );
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '快捷键保存',
  );
  await waitFor(
    async () => {
      const config = await readConfig();
      return (
        config?.terminal.fontSize === 13 &&
        config?.ui.density === 'comfortable' &&
        config?.shortcuts.overrides['panel.monitor']?.code === 'KeyJ' &&
        config?.shortcuts.overrides['tab.next'] === null
      );
    },
    5_000,
    '恢复默认与快捷键写入',
  );

  // 改键后新键生效、旧键失效。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-cpu"]') !== null`),
    5_000,
    '新快捷键打开监控面板',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-cpu"]') === null`),
    5_000,
    '新快捷键再按一次关闭',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await delay(400);
  if ((await evaluate(`document.querySelector('[data-testid="monitor-cpu"]') !== null`)) ) {
    throw new Error('旧快捷键应失效');
  }

  // 默认 shell：设置 bash 后新终端跑 bash，切回系统默认后恢复。
  const sessionsBefore = await evaluate(`window.__etermDebug.list()`);
  await openSettings();
  await openSection('terminal');
  await evaluate(setSelectScript('#settings-local-shell', 'bash'));
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '保存启动命令',
  );
  await waitFor(
    async () => (await readConfig())?.terminal.localCommand === 'bash -l',
    5_000,
    '启动命令写入',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', metaKey: true, bubbles: true }))`,
  );
  const bashSession = await waitFor(
    async () => {
      const list = await evaluate(`window.__etermDebug.list()`);
      return list.find((id) => !sessionsBefore.includes(id)) ?? null;
    },
    10_000,
    '新终端会话',
  );
  await evaluate(
    `window.__etermDebug.type(${JSON.stringify(bashSession)}, ${JSON.stringify('echo shell-check-$BASH_VERSION\r')})`,
  );
  const bashOutput = await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(bashSession)})`));
      return /shell-check-\d/.test(text) ? text : null;
    },
    10_000,
    'bash 启动命令生效',
  );
  if (!bashOutput.includes('shell-check-')) throw new Error('启动命令输出异常');
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.list()`)).length === sessionsBefore.length,
    5_000,
    '关闭测试标签',
  );

  await openSettings();
  await openSection('terminal');
  await evaluate(setSelectScript('#settings-local-shell', 'system'));
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    async () => {
      const config = await readConfig();
      return config?.terminal.localCommand === '';
    },
    5_000,
    '清空启动命令',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '关闭设置',
  );

  // 本地 shell 分体按钮：默认用系统 shell；▾ 菜单临时用 bash；自定义命令只作用于本次。
  const openShellMenu = async () => {
    await evaluate(`document.querySelector('[data-testid="tabbar-new-shell"]').click()`);
    await waitFor(
      () => evaluate(`document.querySelector('[data-testid="local-shell-menu"]') !== null`),
      5_000,
      'shell 菜单',
    );
  };

  const menuSessionsBefore = await evaluate(`window.__etermDebug.list()`);
  await openShellMenu();
  await evaluate(`document.querySelector('[data-testid="local-shell-option-bash"]').click()`);
  const menuSession = await waitFor(
    async () => {
      const list = await evaluate(`window.__etermDebug.list()`);
      return list.find((id) => !menuSessionsBefore.includes(id)) ?? null;
    },
    10_000,
    '菜单 bash 终端',
  );
  await evaluate(
    `window.__etermDebug.type(${JSON.stringify(menuSession)}, ${JSON.stringify('echo menu-shell-$BASH_VERSION\r')})`,
  );
  await waitFor(
    async () => /menu-shell-\d/.test(String(await evaluate(`window.__etermDebug.read(${JSON.stringify(menuSession)})`))),
    10_000,
    '菜单 bash 生效',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.list()`)).length === menuSessionsBefore.length,
    5_000,
    '关闭菜单终端',
  );

  const customSessionsBefore = await evaluate(`window.__etermDebug.list()`);
  await openShellMenu();
  await evaluate(`document.querySelector('[data-testid="local-shell-option-custom"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="local-shell-dialog"]') !== null`),
    5_000,
    '自定义 shell 弹窗',
  );
  await evaluate(setInputScript('#local-shell-command', 'echo custom-shell-ok && exec bash -l'));
  await evaluate(`document.querySelector('[data-testid="local-shell-submit"]').click()`);
  const customSession = await waitFor(
    async () => {
      const list = await evaluate(`window.__etermDebug.list()`);
      return list.find((id) => !customSessionsBefore.includes(id)) ?? null;
    },
    10_000,
    '自定义命令终端',
  );
  await waitFor(
    async () =>
      String(await evaluate(`window.__etermDebug.read(${JSON.stringify(customSession)})`)).includes('custom-shell-ok'),
    10_000,
    '自定义命令输出',
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', metaKey: true, bubbles: true }))`,
  );
  await waitFor(
    async () => (await evaluate(`window.__etermDebug.list()`)).length === customSessionsBefore.length,
    5_000,
    '关闭自定义终端',
  );

  // 中英文：切到 English 后设置面板变英文，切回中文恢复。
  await openSettings();
  await openSection('appearance');
  await evaluate(setSelectScript('#settings-language', 'en-US'));
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '保存英文',
  );
  await evaluate(`document.querySelector('[data-testid="open-settings"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.modal--settings .modal__title')?.textContent === 'Settings' && document.querySelector('[data-testid="settings-nav-terminal"]')?.textContent === 'Terminal' && document.querySelector('[data-testid="settings-nav-layout"]')?.textContent === 'Panel Layout'`,
      ),
    5_000,
    '英文设置面板',
  );
  await evaluate(`document.querySelector('[data-testid="settings-nav-appearance"]').click()`);
  await evaluate(setSelectScript('#settings-language', 'zh-CN'));
  await evaluate(`document.querySelector('[data-testid="settings-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') === null`),
    5_000,
    '保存中文',
  );
  await evaluate(`document.querySelector('[data-testid="open-settings"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('.modal--settings .modal__title')?.textContent === '设置'`),
    5_000,
    '中文设置面板',
  );
  await evaluate(`document.querySelector('[data-testid="settings-cancel"]').click()`);

  // 右键菜单模式：配置切到 menu，验证菜单出现与粘贴动作。
  const baseConfig = await evaluate(
    `window.eterm.getConfig().then((result) => (result.ok ? result.value : null))`,
  );
  if (!baseConfig) throw new Error('读取配置失败');
  await evaluate(
    `window.eterm.saveConfig(${JSON.stringify({ ...baseConfig, terminal: { ...baseConfig.terminal, rightClick: 'menu' } })})`,
  );
  await evaluate(`(() => {
    const host = document.querySelector('.pane[data-active="true"] .terminal-host');
    host?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
    return Boolean(host);
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="terminal-menu"]') !== null`),
    5_000,
    '右键菜单',
  );
  await evaluate(
    `document.querySelector('[data-testid="terminal-menu"] .terminal-menu__item:nth-child(2)').click()`,
  );
  await waitFor(
    async () =>
      String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).includes('echo right-click-ok'),
    5_000,
    '菜单粘贴',
  );
  await evaluate(`window.eterm.resetConfig()`);

  // 分隔条拖拽：比例跟着鼠标走，松手后落盘。
  await evaluate(`document.querySelector('[data-testid="split-row"]').click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.pane-node').length === 2`), 5_000, '本地分屏');
  const divider = await evaluate(`(() => {
    const element = document.querySelector('.split__divider');
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: divider.x,
    y: divider.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: divider.x + 150,
    y: divider.y,
    button: 'left',
    buttons: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: divider.x + 150,
    y: divider.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await waitFor(
    () => evaluate(`Number(document.querySelector('.split__child')?.style.flexGrow) > 0.55`),
    5_000,
    '拖拽后比例变化',
  );
  await waitFor(
    async () => {
      try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'layout.json'), 'utf8'));
        const template = parsed.splits?.local;
        return template?.type === 'split' && template.ratio > 0.55 ? template : null;
      } catch {
        return null;
      }
    },
    5_000,
    '拖拽比例落盘',
  );

  // 系统资源面板：⌘⇧M 打开，采样出数值，开关状态写入 layout.json。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="panel-frame-monitor"]') !== null`),
    5_000,
    '系统资源面板',
  );
  await waitFor(
    () => evaluate(`/\\d+%/.test(document.querySelector('[data-testid="monitor-cpu"]')?.textContent ?? '')`),
    5_000,
    '系统资源采样',
  );
  await waitFor(
    () => evaluate(`(document.querySelector('[data-testid="monitor-memory"]')?.textContent ?? '').includes('/')`),
    5_000,
    '内存采样',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-source-badge"]')?.textContent === '本机'`),
    5_000,
    '本机资源来源',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-hostname"]')?.textContent !== '—'`),
    5_000,
    '本机主机名',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-processes"]') !== null`),
    10_000,
    '本机进程 Top5',
  );
  const monitorShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/monitor-smoke.png', Buffer.from(monitorShot.data, 'base64'));

  // 左右停靠区可拖宽度：拖到静态上限 / 下限，验证边界与落盘。
  const dragDockResizer = async (side, dx, dy = 0) => {
    const point = await evaluate(`(() => {
      const element = document.querySelector('[data-testid="dock-resizer-${side}"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`没有 ${side} 侧宽度拖拽条`);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x + dx,
      y: point.y + dy,
      button: 'left',
      buttons: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x + dx,
      y: point.y + dy,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  };
  const dockSizes = () =>
    evaluate(`window.eterm.getPanelLayout().then((result) => (result.ok ? result.value.sizes : null))`);

  await dragDockResizer('right', -400);
  await waitFor(async () => (await dockSizes())?.right === 450, 5_000, '右栏拖到上限');
  await dragDockResizer('right', 400);
  await waitFor(async () => (await dockSizes())?.right === 260, 5_000, '右栏拖到下限');
  await dragDockResizer('left', 200);
  await waitFor(async () => (await dockSizes())?.left === 360, 5_000, '左栏拖到上限');
  await dragDockResizer('left', -300);
  await waitFor(async () => (await dockSizes())?.left === 220, 5_000, '左栏拖到下限');
  await dragDockResizer('bottom', 0, -200);
  await waitFor(async () => (await dockSizes())?.bottom === 360, 5_000, '底栏拖到上限');
  await dragDockResizer('bottom', 0, 260);
  await waitFor(async () => (await dockSizes())?.bottom === 120, 5_000, '底栏拖到下限');
  await waitFor(
    async () => {
      try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'layout.json'), 'utf8'));
        return (
          parsed.panels?.sizes?.left === 220 &&
          parsed.panels?.sizes?.right === 260 &&
          parsed.panels?.sizes?.bottom === 120
        );
      } catch {
        return false;
      }
    },
    5_000,
    '停靠区尺寸落盘',
  );

  // 右侧两个面板：拖分隔改比例并落盘，再用齿轮菜单把系统资源移到左侧并改回。
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-right"] .dock__item').length === 2`),
    5_000,
    '右侧两个面板',
  );
  const dockDivider = await evaluate(`(() => {
    const element = document.querySelector('[data-testid="dock-divider-right-0"]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!dockDivider) throw new Error('没有右侧分隔条');
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: dockDivider.x,
    y: dockDivider.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dockDivider.x,
    y: dockDivider.y - 120,
    button: 'left',
    buttons: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: dockDivider.x,
    y: dockDivider.y - 120,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await waitFor(
    async () => {
      try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'layout.json'), 'utf8'));
        const ratio = parsed.panels?.dividers?.right?.[0];
        return typeof ratio === 'number' && ratio < 0.45;
      } catch {
        return false;
      }
    },
    5_000,
    '停靠区分隔比例落盘',
  );

  // 区内顺序：右侧 files / monitor，把 monitor 上移再下移，比例跟面板走。
  const rightOrder = () =>
    evaluate(`window.eterm.getPanelLayout().then((result) => (result.ok ? result.value.docks.right : null))`);
  const rightRatio = () =>
    evaluate(
      `window.eterm.getPanelLayout().then((result) => (result.ok ? result.value.dividers.right[0] : null))`,
    );
  const initialOrder = await rightOrder();
  if (!Array.isArray(initialOrder) || initialOrder[0] !== 'files') {
    throw new Error(`右侧初始顺序异常：${JSON.stringify(initialOrder)}`);
  }
  const ratioBefore = await rightRatio();
  if (typeof ratioBefore !== 'number' || ratioBefore >= 0.45) {
    throw new Error(`右侧分隔比例异常：${String(ratioBefore)}`);
  }

  await evaluate(`document.querySelector('[data-testid="panel-menu-monitor"]').click()`);
  await evaluate(`document.querySelector('[data-testid="panel-up-monitor"]').click()`);
  await waitFor(
    async () => {
      const order = await rightOrder();
      return Array.isArray(order) && order[0] === 'monitor';
    },
    5_000,
    '面板上移',
  );
  const ratioAfterUp = await rightRatio();
  if (typeof ratioAfterUp !== 'number' || ratioAfterUp <= 0.5) {
    throw new Error(`上移后比例没有跟面板走：${String(ratioAfterUp)}`);
  }

  await evaluate(`document.querySelector('[data-testid="panel-menu-monitor"]').click()`);
  await evaluate(`document.querySelector('[data-testid="panel-down-monitor"]').click()`);
  await waitFor(
    async () => {
      const order = await rightOrder();
      return Array.isArray(order) && order[0] === 'files';
    },
    5_000,
    '面板下移',
  );
  const ratioAfterDown = await rightRatio();
  if (typeof ratioAfterDown !== 'number' || Math.abs(ratioAfterDown - ratioBefore) > 0.01) {
    throw new Error(`下移后比例未还原：${String(ratioAfterDown)} vs ${String(ratioBefore)}`);
  }

  await evaluate(`document.querySelector('[data-testid="panel-menu-monitor"]').click()`);
  await evaluate(`document.querySelector('[data-testid="panel-dock-monitor-left"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-left"] .dock__item').length === 2`),
    5_000,
    '系统资源移到左侧',
  );
  await evaluate(`document.querySelector('[data-testid="panel-menu-monitor"]').click()`);
  await evaluate(`document.querySelector('[data-testid="panel-dock-monitor-right"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-right"] .dock__item').length === 2`),
    5_000,
    '系统资源移回右侧',
  );
  await waitFor(
    async () => {
      try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'layout.json'), 'utf8'));
        return parsed.panels?.docks?.right?.includes('monitor') === true;
      } catch {
        return false;
      }
    },
    5_000,
    '面板开关落盘',
  );

  // 设置面板入口：把系统资源改到左侧，再改回右侧。
  await evaluate(`document.querySelector('[data-testid="open-settings"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') !== null`),
    5_000,
    '设置面板',
  );
  await evaluate(`document.querySelector('[data-testid="settings-nav-layout"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-dock-monitor"]') !== null`),
    5_000,
    '设置面板布局分区',
  );
  await evaluate(setSelectScript('[data-testid="settings-dock-monitor"]', 'left'));
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-left"] .dock__item').length === 2`),
    5_000,
    '设置里改到左侧',
  );
  await evaluate(setSelectScript('[data-testid="settings-dock-monitor"]', 'right'));
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-right"] .dock__item').length === 2`),
    5_000,
    '设置里改回右侧',
  );
  await evaluate(`document.querySelector('[data-testid="settings-cancel"]').click()`);

  // 重载页面：面板布局与分隔比例应从 layout.json 恢复（等价于重启应用）。
  await Promise.resolve(evaluate(`location.reload()`)).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="dock-right"] .dock__item').length === 2`),
    15_000,
    '重载后布局恢复',
  );
  const persistedRatio = await (async () => {
    const parsed = JSON.parse(await readFile(join(dataDir, 'layout.json'), 'utf8'));
    return parsed.panels?.dividers?.right?.[0];
  })();
  if (typeof persistedRatio !== 'number') throw new Error('layout.json 缺少右侧分隔比例');
  await waitFor(
    () =>
      evaluate(`(() => {
        const grow = Number(document.querySelector('[data-testid="dock-right"] .dock__item')?.style.flexGrow ?? NaN);
        return Number.isFinite(grow) && Math.abs(grow - ${persistedRatio}) < 0.01;
      })()`),
    5_000,
    '重载后分隔比例恢复',
  );

  await evaluate(`document.querySelector('[data-testid="panel-close-monitor"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="panel-frame-monitor"]') === null`),
    5_000,
    '关闭系统资源',
  );

  const transferEmpty = await evaluate(
    `document.querySelector('[data-testid="transfer-empty"]')?.innerText ?? ''`,
  );
  if (!transferEmpty.includes('还没有传输任务') || !transferEmpty.includes('上传或下载')) {
    throw new Error(`传输队列空态缺少说明或提示：${transferEmpty}`);
  }
  await evaluate(`document.querySelector('[data-testid="panel-close-files"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="panel-frame-files"]') === null`),
    5_000,
    '关闭文件面板',
  );
  await evaluate(`document.querySelector('[data-testid="transfer-open-files"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="panel-frame-files"]') !== null`),
    5_000,
    '空态动作打开文件面板',
  );

  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'));

  // 全部面板可关闭：停靠区不再渲染，工作区自己撑满。
  for (const panelId of ['sessions', 'files', 'transfers']) {
    await evaluate(`document.querySelector('[data-testid="panel-close-${panelId}"]')?.click()`);
  }
  await waitFor(() => evaluate(`document.querySelectorAll('.dock').length === 0`), 5_000, '关闭全部面板');
  const workspaceWidth = await evaluate(
    `document.querySelector('.workspace')?.getBoundingClientRect().width ?? 0`,
  );
  if (!(workspaceWidth > 900)) throw new Error(`关闭面板后工作区未撑满：${workspaceWidth}`);

  const tail = screen.split('\n').filter(Boolean).slice(-2).join(' | ');
  // 原生菜单与托盘只在主进程存在，用启动日志证明装配成功。
  const startupLogs = appLogs.join('');
  if (!startupLogs.includes('[menu] 已装配：ETerm / 文件 / 编辑 / 视图 / 窗口 / 帮助')) {
    throw new Error('原生菜单未按预期装配');
  }
  if (!startupLogs.includes('[tray] 已创建')) {
    throw new Error('托盘未创建（缺模板图或图片为空）');
  }
  console.log(`冒烟通过：终端输出「${tail}」，截图 ${SCREENSHOT}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`冒烟失败：${error.message}`);
  if (client) {
    try {
      const structure = await client.send('Runtime.evaluate', {
        expression: `document.querySelector('.terminal-host')?.innerHTML.slice(0, 1200) ?? 'no terminal'`,
        returnByValue: true,
      });
      console.error(`终端 DOM：${structure.result?.value}`);
    } catch {
      // 诊断信息拿不到就只保留原始错误。
    }
  }
  process.exitCode = 1;
} finally {
  client?.close();
  app.kill('SIGTERM');
  await delay(500);
  if (app.exitCode === null) app.kill('SIGKILL');
}
