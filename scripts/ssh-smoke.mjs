import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve, sep } from 'node:path';
import electronPath from 'electron';
import pty from 'node-pty';
import ssh2 from 'ssh2';

const { Server, utils } = ssh2;
const OPEN_READ = 0x00000001;
const OPEN_WRITE = 0x00000002;
const STATUS = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3, FAILURE: 4 };
const DEBUG_PORT = 9334;
const MARKER = 'ssh-smoke-ok';
const SCREENSHOT = 'tmp/ssh-smoke.png';

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

await run(process.execPath, ['scripts/build-main.mjs']);
await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);

const dataDir = join(process.cwd(), 'tmp', 'ssh-smoke', randomUUID());
mkdirSync(dataDir, { recursive: true });
const keyPair = utils.generateKeyPairSync('ed25519');
const keyPath = join(dataDir, 'id_ed25519');
writeFileSync(keyPath, keyPair.private, { mode: 0o600 });
const uploadFixture = join(dataDir, 'upload.txt');
writeFileSync(uploadFixture, 'upload-from-smoke\n');
const downloadTarget = join(dataDir, 'downloaded.txt');

// SFTP 沙盒：文件面板从这里列目录、打开文件。
const remoteRoot = join(dataDir, 'remote');
mkdirSync(join(remoteRoot, 'docs'), { recursive: true });
writeFileSync(join(remoteRoot, 'readme.txt'), 'hello-from-sftp\nline two\n');
writeFileSync(join(remoteRoot, 'docs', 'guide.md'), '# Guide\n');

function resolveRemote(input) {
  const rel = String(input || '/').replace(/^\/+/, '');
  const full = resolve(remoteRoot, rel);
  if (full !== remoteRoot && !full.startsWith(remoteRoot + sep)) {
    throw new Error('路径越界');
  }
  return full;
}

function remoteName(full) {
  if (full === remoteRoot) return '/';
  return `/${full.slice(remoteRoot.length + 1).split(sep).join('/')}`;
}

function attrsOf(stats) {
  return {
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  };
}

const hostKey = utils.generateKeyPairSync('ed25519');
const connections = new Set();
const server = new Server({ hostKeys: [hostKey.private] }, (connection) => {
  connections.add(connection);
  connection.on('close', () => connections.delete(connection));
  connection.on('close', () => console.log('[mock] connection closed'));
  connection.on('error', (error) => console.log('[mock] connection error', error.message));
  connection.on('authentication', (context) => {
    if (context.method === 'publickey') {
      context.accept();
      return;
    }
    if (context.method === 'password' && context.username === 'tester' && context.password === 'secret') {
      context.accept();
      return;
    }
    context.reject(['publickey', 'password']);
  });
  connection.on('ready', () => {
    connection.on('session', (accept) => {
      const session = accept();
      let shellProcess = null;
      let ptyInfo = null;

      session.on('pty', (acceptPty, _reject, info) => {
        ptyInfo = info;
        acceptPty();
      });
      session.on('window-change', (_accept, _reject, info) => {
        shellProcess?.resize(info.cols, info.rows);
      });

      session.on('sftp', (acceptSftp) => {
        const sftp = acceptSftp();
        const handles = new Map();
        let nextHandle = 1;
        const createHandle = (state) => {
          const handle = Buffer.alloc(4);
          handle.writeUInt32BE(nextHandle, 0);
          handles.set(nextHandle, state);
          nextHandle += 1;
          return handle;
        };
        const stateOf = (handle) => (handle.length === 4 ? handles.get(handle.readUInt32BE(0)) : undefined);

        sftp.on('REALPATH', (reqid, path) => {
          try {
            const full = resolveRemote(path);
            const name = remoteName(full);
            sftp.name(reqid, [{ filename: name, longname: name, attrs: {} }]);
          } catch {
            sftp.status(reqid, STATUS.NO_SUCH_FILE);
          }
        });

        const onStat = async (reqid, path) => {
          try {
            sftp.attrs(reqid, attrsOf(await stat(resolveRemote(path))));
          } catch {
            sftp.status(reqid, STATUS.NO_SUCH_FILE);
          }
        };
        sftp.on('STAT', onStat);
        sftp.on('LSTAT', onStat);

        sftp.on('OPENDIR', async (reqid, path) => {
          try {
            const full = resolveRemote(path);
            const dirents = await readdir(full, { withFileTypes: true });
            const entries = [];
            for (const dirent of dirents) {
              const info = await lstat(join(full, dirent.name));
              entries.push({ filename: dirent.name, longname: dirent.name, attrs: attrsOf(info) });
            }
            sftp.handle(reqid, createHandle({ type: 'dir', entries, sent: false }));
          } catch {
            sftp.status(reqid, STATUS.NO_SUCH_FILE);
          }
        });

        sftp.on('READDIR', (reqid, handle) => {
          const state = stateOf(handle);
          if (!state || state.type !== 'dir') return sftp.status(reqid, STATUS.FAILURE);
          if (state.sent) return sftp.status(reqid, STATUS.EOF);
          state.sent = true;
          return sftp.name(reqid, state.entries);
        });

        sftp.on('OPEN', async (reqid, filename, flags) => {
          try {
            const full = resolveRemote(filename);
            if (flags & OPEN_READ) {
              const data = await readFile(full);
              return sftp.handle(reqid, createHandle({ type: 'file', data }));
            }
            if (flags & OPEN_WRITE) {
              return sftp.handle(reqid, createHandle({ type: 'file-write', path: full, chunks: [] }));
            }
            return sftp.status(reqid, STATUS.PERMISSION_DENIED);
          } catch {
            return sftp.status(reqid, STATUS.NO_SUCH_FILE);
          }
        });

        sftp.on('WRITE', (reqid, handle, offset, data) => {
          const state = stateOf(handle);
          if (!state || state.type !== 'file-write') return sftp.status(reqid, STATUS.FAILURE);
          state.chunks.push({ offset, data: Buffer.from(data) });
          return sftp.status(reqid, STATUS.OK);
        });

        sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS.OK));

        sftp.on('READ', (reqid, handle, offset, length) => {
          const state = stateOf(handle);
          if (!state || state.type !== 'file') return sftp.status(reqid, STATUS.FAILURE);
          if (offset >= state.data.length) return sftp.status(reqid, STATUS.EOF);
          return sftp.data(reqid, state.data.subarray(offset, Math.min(offset + length, state.data.length)));
        });

        sftp.on('CLOSE', async (reqid, handle) => {
          const state = stateOf(handle);
          if (state) handles.delete(handle.readUInt32BE(0));
          if (state?.type === 'file-write') {
            state.chunks.sort((left, right) => left.offset - right.offset);
            await writeFile(state.path, Buffer.concat(state.chunks.map((chunk) => chunk.data)));
          }
          sftp.status(reqid, STATUS.OK);
        });
      });

      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        const proc = pty.spawn('/bin/zsh', ['-l'], {
          name: 'xterm-256color',
          cols: ptyInfo?.cols ?? 80,
          rows: ptyInfo?.rows ?? 24,
          cwd: remoteRoot,
          env: { ...process.env, TERM: 'xterm-256color' },
        });
        shellProcess = proc;
        stream.on('data', (data) => proc.write(data.toString()));
        proc.onData((data) => stream.write(data));
        stream.on('close', () => proc.kill());
        proc.onExit(({ exitCode }) => {
          shellProcess = null;
          stream.exit(exitCode);
          stream.end();
        });
      });

      session.on('exec', (acceptExec) => {
        const stream = acceptExec();
        stream.write('ok\n');
        stream.exit(0);
        stream.end();
      });
    });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const app = spawn(electronPath, ['.', `--remote-debugging-port=${DEBUG_PORT}`], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ETERM_SMOKE: '1',
    ETERM_USER_DATA: dataDir,
    ETERM_SMOKE_UPLOAD: uploadFixture,
    ETERM_SMOKE_DOWNLOAD: downloadTarget,
  },
});

let client;

try {
  const target = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === 'page') ?? null;
    },
    20_000,
    'CDP 页面目标',
  );

  client = createClient(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
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
    () => evaluate(`document.querySelector('[data-testid="new-connection"]') !== null`),
    10_000,
    '空态',
  );

  await evaluate(`document.querySelector('[data-testid="new-connection"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('#connection-name') !== null`), 5_000, '连接表单');

  await evaluate(setInputScript('#connection-name', 'mock-host'));
  await evaluate(setInputScript('#connection-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-port', String(port)));
  await evaluate(setInputScript('#connection-user', 'tester'));
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '私钥字段');
  await evaluate(setInputScript('#connection-key', keyPath));

  await evaluate(`document.querySelector('[data-testid="connection-save-connect"]').click()`);

  const fingerprint = await waitFor(
    () => evaluate(`document.querySelector('.fingerprint')?.textContent ?? ''`),
    15_000,
    '主机指纹弹窗',
  );
  if (!/^SHA256:/.test(fingerprint)) throw new Error(`指纹格式异常：${fingerprint}`);

  await evaluate(`document.querySelector('[data-testid="hostkey-trust"]').click()`);

  const sessionId = await waitFor(
    () => evaluate(`document.querySelector('.terminal-host')?.dataset.sessionId ?? ''`),
    15_000,
    'SSH 终端挂载',
  );
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).trim().length > 0,
    10_000,
    'SSH prompt',
  );

  const typed = await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, "echo ${MARKER}\\r")`);
  if (!typed) throw new Error('SSH 会话已关闭，无法输入');
  const screen = await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
      const occurrences = (text.match(new RegExp(MARKER, 'g')) ?? []).length;
      return occurrences === 2 ? text : '';
    },
    10_000,
    'SSH 命令回显',
  );

  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-panel"]') !== null`),
    10_000,
    '文件面板',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-docs"]') !== null`),
    10_000,
    '文件列表',
  );

  await evaluate(`document.querySelector('[data-testid="file-row-docs"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('.file-panel__path')?.textContent === '/docs'`),
    5_000,
    '进入目录',
  );
  const filesShot = await client.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/ssh-smoke-files.png', Buffer.from(filesShot.data, 'base64'));

  await evaluate(`document.querySelector('button[title="上一级"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('.file-panel__path')?.textContent === '/'`),
    5_000,
    '返回根目录',
  );
  await evaluate(`document.querySelector('[data-testid="file-row-readme.txt"]').click()`);
  const previewText = await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-preview"]')?.innerText ?? ''`),
    10_000,
    '文件预览',
  );
  if (!previewText.includes('hello-from-sftp')) throw new Error('文件预览内容不正确');

  // 关闭预览与标签，再次点击连接：指纹已保存，不应再弹确认。
  await evaluate(`document.querySelector('[data-testid="file-preview"] .button--primary').click()`);
  await evaluate(`document.querySelector('.tab__close').click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.terminal-host').length === 0`), 5_000, '关闭标签');
  await evaluate(
    `document.querySelector('[data-testid="connection-row-mock-host"] .tree-connection__main').click()`,
  );
  const reconnectId = await waitFor(
    () => evaluate(`document.querySelector('.terminal-host')?.dataset.sessionId ?? ''`),
    10_000,
    '重连终端',
  );
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(reconnectId)})`)).trim().length > 0,
    10_000,
    '重连 prompt',
  );
  const dialogAfterReconnect = await evaluate(`document.querySelector('.fingerprint') !== null`);
  if (dialogAfterReconnect) throw new Error('重连不应再弹指纹确认');

  // 分屏：同一连接再开一个独立会话，形成两个 pane。
  await evaluate(`document.querySelector('[data-testid="split-row"]').click()`);
  const splitSessions = await waitFor(
    async () => {
      const ids = await evaluate(`[...document.querySelectorAll('.terminal-host')].map((element) => element.dataset.sessionId)`);
      return ids.length >= 2 ? ids : null;
    },
    15_000,
    '分屏终端',
  );
  const splitSession = splitSessions[splitSessions.length - 1];
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(splitSession)})`)).trim().length > 0,
    10_000,
    '分屏 prompt',
  );
  const splitTyped = await evaluate(`window.__etermDebug.type(${JSON.stringify(splitSession)}, "echo split-ok\\r")`);
  if (!splitTyped) throw new Error('分屏会话已关闭，无法输入');
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(splitSession)})`));
      return (text.match(/split-ok/g) ?? []).length === 2;
    },
    10_000,
    '分屏命令回显',
  );

  const splitShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ssh-smoke-split.png', Buffer.from(splitShot.data, 'base64'));

  // 布局落盘后关标签，再点连接：应恢复双 pane。
  await waitFor(
    async () => {
      try {
        const raw = await readFile(join(dataDir, 'layout.json'), 'utf8');
        return raw.includes('"type": "split"') ? raw : null;
      } catch {
        return null;
      }
    },
    5_000,
    '布局落盘',
  );
  await evaluate(`document.querySelector('.tab__close').click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.terminal-host').length === 0`), 5_000, '关闭标签');
  await evaluate(
    `document.querySelector('[data-testid="connection-row-mock-host"] .tree-connection__main').click()`,
  );
  await waitFor(
    () => evaluate(`document.querySelectorAll('.pane-node').length === 2`),
    15_000,
    '恢复分屏',
  );

  await evaluate(`[...document.querySelectorAll('.pane-node__header button')].at(-1).click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('.terminal-host').length === 1`),
    5_000,
    '关闭分屏',
  );

  // 上传：文件面板按钮 → 队列 → 远端落盘。
  await evaluate(`document.querySelector('[data-testid="file-upload"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('.transfer-row[data-status="done"]') !== null`),
    20_000,
    '上传完成',
  );
  const uploaded = await readFile(join(remoteRoot, 'upload.txt'), 'utf8');
  if (!uploaded.includes('upload-from-smoke')) throw new Error('上传内容不正确');

  await evaluate(`document.querySelector('button[title="刷新"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-upload.txt"]') !== null`),
    5_000,
    '上传文件出现在列表',
  );

  // 下载：文件行下载按钮 → 队列 → 本地落盘。
  await evaluate(`document.querySelector('[data-testid="file-download-readme.txt"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelectorAll('.transfer-row[data-status="done"]').length >= 2`),
    20_000,
    '下载完成',
  );
  const downloaded = await readFile(downloadTarget, 'utf8');
  if (!downloaded.includes('hello-from-sftp')) throw new Error('下载内容不正确');

  const transferShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ssh-smoke-transfer.png', Buffer.from(transferShot.data, 'base64'));

  // 第二个连接只保存不连接，用来验证排序；避开 Keychain 授权。
  await evaluate(`document.querySelector('.session-tree__header button[title="新建连接"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('#connection-name') !== null`), 5_000, '第二个连接表单');
  await evaluate(setInputScript('#connection-name', 'mock-second'));
  await evaluate(setInputScript('#connection-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-port', String(port)));
  await evaluate(setInputScript('#connection-user', 'tester'));
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '第二个私钥字段');
  await evaluate(setInputScript('#connection-key', keyPath));
  await evaluate(`document.querySelector('[data-testid="connection-save"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="connection-row-mock-second"]') !== null`),
    10_000,
    '第二个连接保存',
  );

  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'));

  const tail = screen.split('\n').filter(Boolean).slice(-1)[0] ?? '';
  console.log(`SSH 冒烟通过：指纹 ${fingerprint}，终端输出「${tail}」，截图 ${SCREENSHOT}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`SSH 冒烟失败：${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  app.kill('SIGTERM');
  await delay(500);
  if (app.exitCode === null) app.kill('SIGKILL');
  for (const connection of connections) connection.end();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
