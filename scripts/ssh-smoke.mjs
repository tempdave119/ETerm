import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { lstat, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
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

  // CDP 断开后 send 会静默丢弃，pending 永远不结算；主动拒绝比无限等待好定位。
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('CDP WebSocket 已关闭'));
    pending.clear();
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
// 8 MiB：既走真实流式上传，也给「取消传输」留出足够长的可点击窗口（mock 每块延迟 25ms）。
writeFileSync(uploadFixture, `upload-from-smoke\n${'x'.repeat(8 * 1024 * 1024)}`);
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
    // denied 用户用于错误矩阵：模拟服务器拒绝密钥，覆盖 AUTH_FAILED 归一分支
    // （不走密码存储，避免开发版调用 safeStorage 时弹系统钥匙串授权）。
    if (context.method === 'publickey' && context.username !== 'denied') {
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

        sftp.on('WRITE', async (reqid, handle, offset, data) => {
          const state = stateOf(handle);
          if (!state || state.type !== 'file-write') return sftp.status(reqid, STATUS.FAILURE);
          // 每块延迟 25ms：让上传在队列里停留几秒，取消按钮才有可点击的窗口。
          await delay(25);
          if (!stateOf(handle)) return;
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

// 跳板机：只做认证 + direct-tcpip 转发，通道接到主服务器端口。
const jumpConnections = new Set();
const jumpServer = new Server(
  { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
  (connection) => {
    jumpConnections.add(connection);
    connection.on('close', () => jumpConnections.delete(connection));
    connection.on('error', () => {});
    connection.on('authentication', (context) => {
      if (context.method === 'publickey') context.accept();
      else context.reject(['publickey']);
    });
    connection.on('ready', () => {
      connection.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1' || info.destPort !== port) {
          reject();
          return;
        }
        const stream = accept();
        const socket = net.connect(info.destPort, info.destIP, () => {
          socket.pipe(stream).pipe(socket);
        });
        socket.on('error', () => stream.close());
        stream.on('close', () => socket.destroy());
      });
    });
  },
);
await new Promise((resolve) => jumpServer.listen(0, '127.0.0.1', resolve));
const jumpPort = jumpServer.address().port;

// HTTP CONNECT 代理：把隧道接到主服务器端口。
const proxyServer = http.createServer();
proxyServer.on('connect', (request, clientSocket, head) => {
  const [host, portText] = (request.url ?? '').split(':');
  const upstream = net.connect(Number(portText), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
});
await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
const proxyPort = proxyServer.address().port;

// 无 SFTP 的对照服务器：只接认证与 shell，用来验证「能力降级」而不是报错阻塞终端。
const noSftpConnections = new Set();
const noSftpServer = new Server(
  { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
  (connection) => {
    noSftpConnections.add(connection);
    connection.on('close', () => noSftpConnections.delete(connection));
    connection.on('error', () => {});
    connection.on('authentication', (context) => {
      if (context.method === 'publickey' || context.method === 'password') context.accept();
      else context.reject(['publickey', 'password']);
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
      });
    });
  },
);
await new Promise((resolve) => noSftpServer.listen(0, '127.0.0.1', resolve));
const noSftpPort = noSftpServer.address().port;

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

  // ---- F-13.4 错误矩阵：错主机 / 错密码 / 文件不存在 / 取消传输 / 无 SFTP 降级 / 错指纹 ----
  const clickOn = (selector) =>
    evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);

  const textOf = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);

  const shotOf = async (file) => {
    mkdirSync('tmp', { recursive: true });
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(result.data, 'base64'));
  };

  const saveAndConnect = async (options) => {
    await clickOn('.session-tree__header button[title="新建连接"]');
    await waitFor(() => evaluate(`document.querySelector('#connection-name') !== null`), 5_000, `${options.name} 表单`);
    await evaluate(setInputScript('#connection-name', options.name));
    await evaluate(setInputScript('#connection-host', options.host));
    await evaluate(setInputScript('#connection-port', String(options.port)));
    await evaluate(setInputScript('#connection-user', options.username));
    await evaluate(setSelectScript('#connection-auth', options.auth));
    await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '私钥字段');
    await evaluate(setInputScript('#connection-key', keyPath));
    await clickOn('[data-testid="connection-save-connect"]');
  };

  const waitErrorTitle = (expected, label) =>
    waitFor(
      async () => {
        // 表单报错说明连接根本没发出去，直接报出来比等超时更好定位。
        const formError = String(await textOf('.form-error'));
        if (formError) throw new Error(`表单报错「${formError}」`);
        const title = String(await textOf('.error-message__title'));
        return title.includes(expected) ? title : '';
      },
      15_000,
      label,
    );

  // 跳板机：先保存一个只做转发的连接，再让目标连接经由它。
  await clickOn('.session-tree__header button[title="新建连接"]');
  await waitFor(() => evaluate(`document.querySelector('#connection-name') !== null`), 5_000, '跳板连接表单');
  await evaluate(setInputScript('#connection-name', 'mock-jump'));
  await evaluate(setInputScript('#connection-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-port', String(jumpPort)));
  await evaluate(setInputScript('#connection-user', 'tester'));
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '跳板私钥字段');
  await evaluate(setInputScript('#connection-key', keyPath));
  await clickOn('[data-testid="connection-save"]');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="connection-row-mock-jump"]') !== null`),
    10_000,
    '跳板连接保存',
  );

  await clickOn('.session-tree__header button[title="新建连接"]');
  await waitFor(() => evaluate(`document.querySelector('#connection-jump') !== null`), 5_000, '跳板下拉');
  await evaluate(setInputScript('#connection-name', 'mock-via-jump'));
  await evaluate(setInputScript('#connection-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-port', String(port)));
  await evaluate(setInputScript('#connection-user', 'tester'));
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '跳板目标私钥');
  await evaluate(setInputScript('#connection-key', keyPath));
  const jumpValue = await evaluate(
    `[...document.querySelectorAll('#connection-jump option')].find((option) => option.textContent.startsWith('mock-jump'))?.value ?? ''`,
  );
  if (!jumpValue) throw new Error('跳板机下拉里没有 mock-jump');
  await evaluate(setSelectScript('#connection-jump', jumpValue));
  await clickOn('[data-testid="connection-save-connect"]');

  // 跳板首次连接仍需确认它自己的指纹，而不是目标主机的。
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="hostkey-trust"]') !== null`),
    15_000,
    '跳板指纹确认',
  );
  const jumpFingerprint = String(await evaluate(`document.querySelector('.fingerprint')?.textContent ?? ''`));
  if (!jumpFingerprint.startsWith('SHA256:')) throw new Error(`跳板指纹格式异常：${jumpFingerprint}`);
  await clickOn('[data-testid="hostkey-trust"]');
  await waitFor(
    () => evaluate(`document.querySelector('.tab__label[title="mock-via-jump"]') !== null`),
    15_000,
    '跳板标签',
  );
  const jumpSession = await waitFor(
    () => evaluate(`[...document.querySelectorAll('.terminal-host')].at(-1)?.dataset.sessionId ?? ''`),
    10_000,
    '跳板会话',
  );
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(jumpSession)})`)).trim().length > 0,
    10_000,
    '跳板 prompt',
  );
  const jumpTyped = await evaluate(`window.__etermDebug.type(${JSON.stringify(jumpSession)}, "echo jump-ok\\r")`);
  if (!jumpTyped) throw new Error('跳板会话已关闭，无法输入');
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(jumpSession)})`));
      return (text.match(/jump-ok/g) ?? []).length === 2;
    },
    10_000,
    '跳板命令回显',
  );
  await shotOf('tmp/ssh-smoke-jump.png');

  // 代理：HTTP CONNECT 直连目标；目标指纹已在前面确认，不再弹窗。
  await clickOn('.session-tree__header button[title="新建连接"]');
  await waitFor(() => evaluate(`document.querySelector('#connection-name') !== null`), 5_000, '代理连接表单');
  await evaluate(setInputScript('#connection-name', 'mock-via-proxy'));
  await evaluate(setInputScript('#connection-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-port', String(port)));
  await evaluate(setInputScript('#connection-user', 'tester'));
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '代理目标私钥');
  await evaluate(setInputScript('#connection-key', keyPath));
  await evaluate(setSelectScript('#connection-proxy-type', 'http'));
  await waitFor(() => evaluate(`document.querySelector('#connection-proxy-host') !== null`), 5_000, '代理字段');
  await evaluate(setInputScript('#connection-proxy-host', '127.0.0.1'));
  await evaluate(setInputScript('#connection-proxy-port', String(proxyPort)));
  await clickOn('[data-testid="connection-save-connect"]');
  await waitFor(
    () => evaluate(`document.querySelector('.tab__label[title="mock-via-proxy"]') !== null`),
    15_000,
    '代理标签',
  );
  const proxySession = await waitFor(
    () => evaluate(`[...document.querySelectorAll('.terminal-host')].at(-1)?.dataset.sessionId ?? ''`),
    10_000,
    '代理会话',
  );
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(proxySession)})`)).trim().length > 0,
    10_000,
    '代理 prompt',
  );
  const proxyTyped = await evaluate(`window.__etermDebug.type(${JSON.stringify(proxySession)}, "echo proxy-ok\\r")`);
  if (!proxyTyped) throw new Error('代理会话已关闭，无法输入');
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(proxySession)})`));
      return (text.match(/proxy-ok/g) ?? []).length === 2;
    },
    10_000,
    '代理命令回显',
  );
  await shotOf('tmp/ssh-smoke-proxy.png');

  // 错主机：端口 1 必然拒连 → HOST_UNREACHABLE。
  await saveAndConnect({ name: 'error-host', host: '127.0.0.1', port: 1, username: 'tester', auth: 'key' });
  await waitErrorTitle('连不上主机', '错主机错误文案');
  await shotOf('tmp/error-host.png');

  // 认证失败：mock 拒绝 denied 用户的密钥 → AUTH_FAILED（与错误密码同一条归一分支）。
  await saveAndConnect({
    name: 'error-auth',
    host: '127.0.0.1',
    port,
    username: 'denied',
    auth: 'key',
  });
  await waitErrorTitle('认证失败', '认证失败错误文案');
  await shotOf('tmp/error-auth.png');

  // 文件不存在：列表里看到的文件在打开前被删掉 → FILE_NOT_FOUND 落在预览弹窗。
  writeFileSync(join(remoteRoot, 'gone.txt'), 'gone\n');
  await clickOn('button[title="刷新"]');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-gone.txt"]') !== null`),
    5_000,
    '临时文件出现',
  );
  await unlink(join(remoteRoot, 'gone.txt'));
  await clickOn('[data-testid="file-row-gone.txt"]');
  await waitFor(() => evaluate(`document.querySelector('[data-testid="file-preview"]') !== null`), 10_000, '预览错误弹窗');
  const fileError = String(await textOf('[data-testid="file-preview"] .error-message__title'));
  if (!fileError.includes('文件不存在')) throw new Error(`文件不存在文案异常：${fileError}`);
  await shotOf('tmp/error-file.png');
  await clickOn('[data-testid="file-preview"] .button--primary');

  // 取消传输：8 MiB 上传在 mock 每块 25ms 下会停留数秒，足以点取消。
  await clickOn('[data-testid="file-upload"]');
  await waitFor(
    () => evaluate(`document.querySelector('.transfer-row[data-status="running"]') !== null`),
    15_000,
    '上传开跑',
  );
  await clickOn('.transfer-row[data-status="running"] button[title="取消传输"]');
  await waitFor(
    () => evaluate(`document.querySelector('.transfer-row[data-status="canceled"]') !== null`),
    10_000,
    '取消传输',
  );
  const canceledHasError = await evaluate(
    `document.querySelector('.transfer-row[data-status="canceled"]')?.closest('.transfer-item')?.querySelector('.error-message') != null`,
  );
  if (canceledHasError) throw new Error('取消传输不应显示错误块');
  await shotOf('tmp/error-cancel.png');

  // 无 SFTP 降级：终端可用、文件面板不出现，文件通道给出明确原因。
  await saveAndConnect({ name: 'error-nosftp', host: '127.0.0.1', port: noSftpPort, username: 'tester', auth: 'key' });
  // 新服务器首次连接仍需确认指纹，信任后才会真正开会话。
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="hostkey-trust"]') !== null`),
    15_000,
    '无 SFTP 指纹确认',
  );
  await clickOn('[data-testid="hostkey-trust"]');
  await waitFor(
    () => evaluate(`document.querySelector('.tab__label[title="error-nosftp"]') !== null`),
    15_000,
    '无 SFTP 标签',
  );
  const noSftpSession = await waitFor(
    () => evaluate(`[...document.querySelectorAll('.terminal-host')].at(-1)?.dataset.sessionId ?? ''`),
    15_000,
    '无 SFTP 会话',
  );
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(noSftpSession)})`)).trim().length > 0,
    10_000,
    '无 SFTP prompt',
  );
  if (await evaluate(`document.querySelector('[data-testid="file-panel"]') !== null`)) {
    throw new Error('无 SFTP 主机不应显示文件面板');
  }
  const noSftpMessage = String(
    await evaluate(
      `window.eterm.listFiles(${JSON.stringify(noSftpSession)}, '/').then((result) => (result.ok ? 'ok' : result.error.message))`,
    ),
  );
  if (!noSftpMessage.includes('没有开启 SFTP')) throw new Error(`无 SFTP 文案异常：${noSftpMessage}`);
  await shotOf('tmp/error-nosftp.png');
  await evaluate(`(() => {
    const label = document.querySelector('.tab__label[title="error-nosftp"]');
    label?.closest('.tab')?.querySelector('.tab__close')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('.tab__label[title="error-nosftp"]') === null`),
    5_000,
    '关闭无 SFTP 标签',
  );

  // 错指纹：先写入错误指纹，再连同一主机 → 弹出「主机指纹已变化」。
  await evaluate(`window.eterm.rememberHostKey('127.0.0.1', ${port}, 'SHA256:${'A'.repeat(43)}')`);
  await saveAndConnect({ name: 'error-hostkey', host: '127.0.0.1', port, username: 'tester', auth: 'key' });
  await waitFor(
    () => evaluate(`document.querySelector('.modal__title')?.textContent?.includes('主机指纹已变化') ?? false`),
    15_000,
    '指纹变化弹窗',
  );
  await shotOf('tmp/error-hostkey.png');
  await clickOn('.modal .modal__actions .button:not(.button--primary)');
  await waitFor(() => evaluate(`document.querySelector('.modal__title') === null`), 5_000, '关闭指纹弹窗');
  const restored = await evaluate(`window.eterm.rememberHostKey('127.0.0.1', ${port}, ${JSON.stringify(fingerprint)})`);
  if (!restored?.ok) throw new Error('恢复正确指纹失败');

  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'));

  const tail = screen.split('\n').filter(Boolean).slice(-1)[0] ?? '';
  console.log(`SSH 冒烟通过：指纹 ${fingerprint}，终端输出「${tail}」，截图 ${SCREENSHOT}`);
  process.exitCode = 0;
} catch (error) {
  if (client) {
    // 失败现场截图：CDP 可能已断，最多等 3 秒，不能让收尾再挂住。
    const shot = await Promise.race([
      client.send('Page.captureScreenshot', { format: 'png' }).catch(() => null),
      delay(3000).then(() => null),
    ]);
    if (shot?.data) {
      mkdirSync('tmp', { recursive: true });
      writeFileSync('tmp/ssh-smoke-failure.png', Buffer.from(shot.data, 'base64'));
    }
  }
  console.error(`SSH 冒烟失败：${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  app.kill('SIGTERM');
  await delay(500);
  if (app.exitCode === null) app.kill('SIGKILL');
  for (const connection of connections) connection.end();
  for (const connection of noSftpConnections) connection.end();
  for (const connection of jumpConnections) connection.end();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    noSftpServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    jumpServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    proxyServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
