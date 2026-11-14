import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { join, delimiter, resolve, sep } from 'node:path';
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
const swapOnly = process.env.ETERM_SWAP_ONLY === '1';

// swap 模式在核心链路跑完后用它提前收尾，保证 finally 清理仍然执行。
class SwapDone extends Error {}

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

if (swapOnly) {
  mkdirSync('tmp', { recursive: true });
  const { build } = await import('esbuild');
  await build({
    entryPoints: ['tests/fixtures/ssh-alt/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['ssh2'],
    outfile: 'tmp/ssh-alt.cjs',
    logLevel: 'silent',
  });
}

const dataDir = join(process.cwd(), 'tmp', 'ssh-smoke', randomUUID());
mkdirSync(dataDir, { recursive: true });
// 可选组件：把示例串口组件放进 userData，启动时由宿主装载。
cpSync(join(process.cwd(), 'examples', 'components', 'serial'), join(dataDir, 'components', 'serial'), {
  recursive: true,
});
const keyPair = utils.generateKeyPairSync('ed25519');
const keyPath = join(dataDir, 'id_ed25519');
writeFileSync(keyPath, keyPair.private, { mode: 0o600 });
const uploadFixture = join(dataDir, 'upload.txt');
// 8 MiB：既走真实流式上传，也给「取消传输」留出足够长的可点击窗口（mock 每块延迟 25ms）。
writeFileSync(uploadFixture, `upload-from-smoke\n${'x'.repeat(8 * 1024 * 1024)}`);
const uploadFixture2 = join(dataDir, 'upload2.txt');
writeFileSync(uploadFixture2, 'upload2-from-smoke\n');
const dragFixture = join(dataDir, 'drag.txt');
writeFileSync(dragFixture, 'drag-from-smoke\n');
const dropDir = join(dataDir, 'dropdir');
mkdirSync(join(dropDir, 'sub'), { recursive: true });
writeFileSync(join(dropDir, 'a.txt'), 'folder-a\n');
writeFileSync(join(dropDir, 'sub', 'b.txt'), 'folder-b\n');
const downloadDir = join(dataDir, 'downloads');
mkdirSync(downloadDir, { recursive: true });
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
    // 本地端口转发会从服务器侧回连目标：只放行本机 echo 端口。
    connection.on('tcpip', (accept, reject, info) => {
      if (info.destIP !== '127.0.0.1' || info.destPort !== echoPort) {
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

        sftp.on('MKDIR', async (reqid, path) => {
          try {
            await mkdir(resolveRemote(path), { recursive: true });
            sftp.status(reqid, STATUS.OK);
          } catch {
            sftp.status(reqid, STATUS.FAILURE);
          }
        });

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

      session.on('exec', (acceptExec, _rejectExec, info) => {
        const stream = acceptExec();
        if (String(info?.command ?? '').includes('MemTotal')) {
          stream.write(
            'cpus=4\nload=0.15 0.20 0.25\ncpu=28\ntotal=8589934592\navail=4294967296\nuptime=7200\nhostname=mock-remote\nfs=/|524288|1048576\nproc=101 512000 1.2 2.5 node\nproc=102 256000 0.5 1.2 zsh\nproc=103 128000 0.1 0.6 sshd\nproc=104 64000 0.0 0.3 bash\nproc=105 32000 0.0 0.1 cron\nproccpu=102 256000 12.5 1.2 zsh\nproccpu=101 512000 1.2 2.5 node\nproccpu=103 128000 0.1 0.6 sshd\nproccpu=104 64000 0.0 0.3 bash\nproccpu=105 32000 0.0 0.1 cron\n',
          );
        } else {
          stream.write('ok\n');
        }
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

// 端口转发的目标：本机 TCP echo。
const echoServer = net.createServer((socket) => socket.pipe(socket));
await new Promise((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
const echoPort = echoServer.address().port;

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
    ETERM_SMOKE_UPLOAD: [uploadFixture, uploadFixture2].join(delimiter),
    ETERM_SMOKE_DOWNLOAD: downloadTarget,
    ETERM_SMOKE_DOWNLOAD_DIR: downloadDir,
    ...(swapOnly ? { ETERM_SSH_ALT_PATH: resolve('tmp/ssh-alt.cjs') } : {}),
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

  // 表单布局：640px 宽，label 在左、与输入框同行。
  const formMetrics = await evaluate(`(() => {
    const modal = document.querySelector('.modal--form');
    const label = document.querySelector('label[for="connection-name"]');
    const input = document.querySelector('#connection-name');
    if (!modal || !label || !input) return null;
    const labelRect = label.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const labelCenter = labelRect.top + labelRect.height / 2;
    const inputCenter = inputRect.top + inputRect.height / 2;
    return {
      width: modal.getBoundingClientRect().width,
      sameRow: Math.abs(labelCenter - inputCenter) < 4 && inputRect.left > labelRect.right,
    };
  })()`);
  if (!formMetrics) throw new Error('连接表单缺少关键元素');
  if (formMetrics.width < 600) throw new Error(`连接表单宽度不足：${formMetrics.width}`);
  if (!formMetrics.sameRow) throw new Error('连接表单 label 未与输入框同行');
  const formPairs = await evaluate(`(() => {
    const nameLabel = document.querySelector('label[for="connection-name"]')?.getBoundingClientRect();
    const groupLabel = document.querySelector('label[for="connection-group"]')?.getBoundingClientRect();
    const hostLabel = document.querySelector('label[for="connection-host"]')?.getBoundingClientRect();
    const portLabel = document.querySelector('label[for="connection-port"]')?.getBoundingClientRect();
    const note = document.querySelector('[data-testid="connection-note"]');
    if (!nameLabel || !groupLabel || !hostLabel || !portLabel) return null;
    return {
      nameGroupSameRow: Math.abs(nameLabel.top - groupLabel.top) < 2 && groupLabel.left > nameLabel.left + 200,
      hostPortSameRow: Math.abs(hostLabel.top - portLabel.top) < 2 && portLabel.left > hostLabel.left + 200,
      hasNote: Boolean(note),
    };
  })()`);
  if (!formPairs || !formPairs.nameGroupSameRow || !formPairs.hostPortSameRow || !formPairs.hasNote) {
    throw new Error(`连接表单成对字段排版不正确：${JSON.stringify(formPairs)}`);
  }

  // 切换认证方式不改变窗口尺寸；备注是多行文本框且高度至少两倍单行输入框。
  const formHeight = () =>
    evaluate(`document.querySelector('.modal--form')?.getBoundingClientRect().height ?? 0`);
  const passwordHeight = await formHeight();
  await evaluate(setSelectScript('#connection-auth', 'key'));
  await waitFor(() => evaluate(`document.querySelector('#connection-key') !== null`), 5_000, '私钥字段');
  const keyHeight = await formHeight();
  await evaluate(setSelectScript('#connection-auth', 'agent'));
  const agentHeight = await formHeight();
  await evaluate(setSelectScript('#connection-auth', 'password'));
  await waitFor(() => evaluate(`document.querySelector('#connection-password') !== null`), 5_000, '密码字段');
  const noteMetrics = await evaluate(`(() => {
    const note = document.querySelector('[data-testid="connection-note"]');
    const name = document.querySelector('#connection-name');
    if (!note || !name) return null;
    return {
      tag: note.tagName,
      noteHeight: note.getBoundingClientRect().height,
      inputHeight: name.getBoundingClientRect().height,
    };
  })()`);
  if (Math.abs(passwordHeight - keyHeight) > 1 || Math.abs(passwordHeight - agentHeight) > 1) {
    throw new Error(`连接表单高度随认证方式变化：${passwordHeight}/${keyHeight}/${agentHeight}`);
  }
  if (!noteMetrics || noteMetrics.tag !== 'TEXTAREA') throw new Error('备注不是多行文本框');
  if (noteMetrics.noteHeight < noteMetrics.inputHeight * 2) {
    throw new Error(`备注高度不足：${noteMetrics.noteHeight} vs ${noteMetrics.inputHeight}`);
  }
  const formShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ssh-smoke-form.png', Buffer.from(formShot.data, 'base64'));

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

  let sessionId = await waitFor(
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
    () => evaluate(`document.querySelector('[data-testid="panel-frame-files"]') !== null`),
    10_000,
    '文件面板',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-docs"]') !== null`),
    10_000,
    '文件列表',
  );

  // 文件面板四列：名称 / 大小 / 日期 / 权限，列头可排序。
  const fileTable = await evaluate(`(() => {
    const head = document.querySelector('[data-testid="file-sort-mode"]');
    const perm = document.querySelector('.file-row__perm')?.textContent ?? '';
    const date = document.querySelector('.file-row__date')?.textContent ?? '';
    return { hasHead: Boolean(head), perm, date };
  })()`);
  if (!fileTable.hasHead) throw new Error('文件面板缺少权限列头');
  if (fileTable.perm !== '—' && !/^\d{3}$/.test(fileTable.perm)) {
    throw new Error(`权限列格式不正确：${fileTable.perm}`);
  }
  if (fileTable.date !== '—' && !/^\d{4}-\d{2}-\d{2}$/.test(fileTable.date)) {
    throw new Error(`日期列格式不正确：${fileTable.date}`);
  }
  await evaluate(`document.querySelector('[data-testid="file-sort-size"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('[data-testid="file-sort-size"]')?.dataset.active === 'true' && document.querySelector('[data-testid="file-toggle-hidden"]') !== null`,
      ),
    5_000,
    '文件列排序与隐藏开关',
  );
  await evaluate(`document.querySelector('[data-testid="file-sort-name"]').click()`);

  // 窄侧栏优先保住文件名：右栏缩到 260 后权限与日期列隐藏，名称仍可见。
  await evaluate(`document.querySelector('[data-testid="open-settings"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-panel"]') !== null`),
    5_000,
    '设置面板',
  );
  await evaluate(`document.querySelector('[data-testid="settings-nav-layout"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="settings-dock-size-right"]') !== null`),
    5_000,
    '设置布局分类',
  );
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="settings-dock-size-right"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '260');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('[data-testid="settings-cancel"]').click()`);
  await waitFor(
    () =>
      evaluate(`(() => {
        const perm = document.querySelector('.file-row__perm');
        const name = document.querySelector('.file-row__name');
        return Boolean(perm) && getComputedStyle(perm).display === 'none' && Boolean(name) && name.getBoundingClientRect().width > 40;
      })()`),
    5_000,
    '窄栏保留文件名',
  );
  const narrowShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ssh-smoke-files-narrow.png', Buffer.from(narrowShot.data, 'base64'));

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

  if (swapOnly) {
    const swapShot = await client.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync('tmp', { recursive: true });
    writeFileSync('tmp/ssh-swap.png', Buffer.from(swapShot.data, 'base64'));
    throw new SwapDone('swap-ok');
  }

  // 自动重连：服务器侧断开连接，客户端 1 秒后重连并恢复终端。
  for (const connection of connections) connection.end();
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="reconnect-bar"]') !== null`),
    10_000,
    '自动重连提示',
  );
  const reconnectedId = await waitFor(
    async () => {
      const id = await evaluate(`document.querySelector('.terminal-host')?.dataset.sessionId ?? ''`);
      return id && id !== sessionId ? id : null;
    },
    15_000,
    '自动重连新会话',
  );
  sessionId = reconnectedId;
  await waitFor(
    async () => String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`)).trim().length > 0,
    10_000,
    '重连 prompt',
  );
  await evaluate(`window.__etermDebug.type(${JSON.stringify(sessionId)}, "echo auto-reconnect-ok\\r")`);
  await waitFor(
    async () => {
      const text = String(await evaluate(`window.__etermDebug.read(${JSON.stringify(sessionId)})`));
      return (text.match(/auto-reconnect-ok/g) ?? []).length === 2;
    },
    10_000,
    '重连命令回显',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="reconnect-bar"]') === null`),
    10_000,
    '重连提示消失',
  );

  // 远端资源：监控面板跟随活动 SSH 会话，显示远端 CPU / 内存。
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', metaKey: true, shiftKey: true, bubbles: true }))`,
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-source-badge"]')?.textContent === '远端'`),
    5_000,
    '远端资源来源',
  );
  const monitorTarget = await evaluate(
    `document.querySelector('.monitor-source__target')?.textContent ?? ''`,
  );
  if (!monitorTarget.includes('@')) throw new Error(`远端资源缺少连接标识：${monitorTarget}`);
  const monitorName = await evaluate(
    `document.querySelector('[data-testid="monitor-source-name"]')?.textContent ?? ''`,
  );
  if (monitorName !== 'mock-host') throw new Error(`远端资源缺少连接名：${monitorName}`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-hostname"]')?.textContent === 'mock-remote'`),
    10_000,
    '远端主机名',
  );
  await waitFor(
    () => evaluate(`/\\d+%/.test(document.querySelector('[data-testid="monitor-cpu"]')?.textContent ?? '')`),
    10_000,
    '远端 CPU',
  );
  await waitFor(
    () =>
      evaluate(`(document.querySelector('[data-testid="monitor-memory"]')?.textContent ?? '').includes('/')`),
    10_000,
    '远端内存',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-uptime"]')?.textContent === '2h 0m'`),
    10_000,
    '远端运行时间',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-filesystems"]') !== null`),
    10_000,
    '远端文件系统',
  );
  await waitFor(
    () => evaluate(`document.querySelectorAll('[data-testid="monitor-processes"] .monitor-process').length === 5`),
    10_000,
    '远端进程 Top5',
  );
  const topProcess = await evaluate(
    `document.querySelector('[data-testid="monitor-processes"] .monitor-process__name')?.textContent ?? ''`,
  );
  if (topProcess !== 'node') throw new Error(`进程 Top5 排序异常：${topProcess}`);
  await evaluate(`document.querySelector('[data-testid="process-sort-cpu"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="monitor-processes"]')?.dataset.sort === 'cpu'`),
    5_000,
    '进程 CPU 排序',
  );
  const topCpuProcess = await evaluate(
    `document.querySelector('[data-testid="monitor-processes"] .monitor-process__name')?.textContent ?? ''`,
  );
  if (topCpuProcess !== 'zsh') throw new Error(`进程 CPU 排序异常：${topCpuProcess}`);
  await waitFor(
    async () =>
      (await evaluate(
        `window.eterm.getConfig().then((result) => (result.ok ? result.value.ui.monitorProcessSort : null))`,
      )) === 'cpu',
    5_000,
    '进程排序写入配置',
  );
  const monitorShot = await client.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/ssh-smoke-monitor.png', Buffer.from(monitorShot.data, 'base64'));

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

  // 上传：文件面板按钮 → 多文件对话框 → 队列 → 远端落盘。
  await evaluate(`document.querySelector('[data-testid="file-upload"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `[...document.querySelectorAll('.transfer-row[data-status="done"]')].filter((row) => /upload2?\\.txt/.test(row.textContent ?? '')).length === 2`,
      ),
    30_000,
    '上传完成',
  );
  const uploaded = await readFile(join(remoteRoot, 'upload.txt'), 'utf8');
  if (!uploaded.includes('upload-from-smoke')) throw new Error('上传内容不正确');
  const uploaded2 = await readFile(join(remoteRoot, 'upload2.txt'), 'utf8');
  if (!uploaded2.includes('upload2-from-smoke')) throw new Error('第二个上传内容不正确');

  await evaluate(`document.querySelector('button[title="刷新"]').click()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-upload.txt"]') !== null`),
    5_000,
    '上传文件出现在列表',
  );
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="file-row-upload2.txt"]') !== null`),
    5_000,
    '第二个上传文件出现在列表',
  );

  // 拖拽上传：CDP 用真实本地文件路径模拟 drop，preload 用 webUtils 换一次性 token。
  const dropPoint = await evaluate(`(() => {
    const element = document.querySelector('.file-panel__list');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!dropPoint) throw new Error('找不到文件面板拖拽区域');
  const dragData = { items: [], files: [dragFixture], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await client.send('Input.dispatchDragEvent', { type, x: dropPoint.x, y: dropPoint.y, data: dragData });
  }
  await waitFor(
    () =>
      evaluate(
        `[...document.querySelectorAll('.transfer-row[data-status="done"]')].some((row) => (row.textContent ?? '').includes('drag.txt'))`,
      ),
    20_000,
    '拖拽上传完成',
  );
  const dragged = await readFile(join(remoteRoot, 'drag.txt'), 'utf8');
  if (!dragged.includes('drag-from-smoke')) throw new Error('拖拽上传内容不正确');

  // 目录拖拽：整个 dropdir 递归创建远端目录并上传文件。
  const folderDragData = { items: [], files: [dropDir], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await client.send('Input.dispatchDragEvent', { type, x: dropPoint.x, y: dropPoint.y, data: folderDragData });
  }
  await waitFor(
    () =>
      evaluate(
        `[...document.querySelectorAll('.transfer-row[data-status="done"]')].filter((row) => /a\\.txt|b\\.txt/.test(row.textContent ?? '')).length === 2`,
      ),
    20_000,
    '目录拖拽上传完成',
  );
  const folderA = await readFile(join(remoteRoot, 'dropdir', 'a.txt'), 'utf8');
  const folderB = await readFile(join(remoteRoot, 'dropdir', 'sub', 'b.txt'), 'utf8');
  if (!folderA.includes('folder-a') || !folderB.includes('folder-b')) {
    throw new Error('目录拖拽上传内容不正确');
  }

  // 下载：文件行下载按钮 → 队列 → 本地落盘。
  await evaluate(`document.querySelector('[data-testid="file-download-readme.txt"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `[...document.querySelectorAll('.transfer-row[data-status="done"]')].some((row) => (row.textContent ?? '').includes('readme.txt'))`,
      ),
    20_000,
    '下载完成',
  );
  const downloaded = await readFile(downloadTarget, 'utf8');
  if (!downloaded.includes('hello-from-sftp')) throw new Error('下载内容不正确');

  // 目录下载：docs 目录递归落到本地 downloads/docs/guide.md。
  await evaluate(`document.querySelector('[data-testid="file-download-docs"]').click()`);
  await waitFor(
    () =>
      evaluate(
        `[...document.querySelectorAll('.transfer-row[data-status="done"]')].some((row) => (row.textContent ?? '').includes('guide.md'))`,
      ),
    20_000,
    '目录下载完成',
  );
  const guide = await readFile(join(downloadDir, 'docs', 'guide.md'), 'utf8');
  if (!guide.includes('# Guide')) throw new Error('目录下载内容不正确');

  const transferShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ssh-smoke-transfer.png', Buffer.from(transferShot.data, 'base64'));

  // 第二个连接只保存不连接，用来验证排序；避开 Keychain 授权。
  await evaluate(`document.querySelector('[data-testid="panel-frame-sessions"] button[title="新建连接"]').click()`);
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
    await clickOn('[data-testid="panel-frame-sessions"] button[title="新建连接"]');
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
  await clickOn('[data-testid="panel-frame-sessions"] button[title="新建连接"]');
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

  await clickOn('[data-testid="panel-frame-sessions"] button[title="新建连接"]');
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
  await clickOn('[data-testid="panel-frame-sessions"] button[title="新建连接"]');
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

  // 端口转发：本地监听 → 经 SSH 通道回连 echo 目标。
  await clickOn('[data-testid="open-forwards"]');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="forward-dialog"]') !== null`),
    5_000,
    '端口转发弹窗',
  );
  await evaluate(setSelectScript('#forward-direction', 'local'));
  await evaluate(setInputScript('#forward-bind-port', '0'));
  await evaluate(setInputScript('#forward-target-host', '127.0.0.1'));
  await evaluate(setInputScript('#forward-target-port', String(echoPort)));
  await clickOn('[data-testid="forward-add"]');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid^="forward-row-"]') !== null`),
    10_000,
    '转发规则',
  );
  const forwardSession = await evaluate(`[...document.querySelectorAll('.terminal-host')].at(-1)?.dataset.sessionId ?? ''`);
  const forwardList = await evaluate(
    `window.eterm.listForwards(${JSON.stringify(forwardSession)}).then((result) => (result.ok ? result.value : []))`,
  );
  const forwardPort = Array.isArray(forwardList) ? forwardList[0]?.bindPort : undefined;
  if (!forwardPort) throw new Error('没有拿到本地转发端口');

  const forwarded = net.connect(forwardPort, '127.0.0.1');
  await new Promise((resolve, reject) => {
    forwarded.once('connect', resolve);
    forwarded.once('error', reject);
  });
  forwarded.write('forward-ok');
  const forwardedEcho = await new Promise((resolve, reject) => {
    forwarded.once('data', resolve);
    forwarded.once('error', reject);
  });
  if (forwardedEcho.toString() !== 'forward-ok') throw new Error('端口转发回显不正确');
  forwarded.destroy();
  await shotOf('tmp/ssh-smoke-forward.png');

  await clickOn('[data-testid="forward-dialog"] [data-testid^="forward-close-"]');
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid^="forward-row-"]') === null`),
    5_000,
    '停止转发',
  );
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-testid="forward-dialog"] .button')];
    buttons.find((button) => button.textContent === '关闭')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('[data-testid="forward-dialog"]') === null`),
    5_000,
    '关闭端口转发',
  );

  // 可选组件：串口协议由 userData/components 装载；设备下拉来自宿主枚举。
  // 真实设备不在 CI 环境，这里只验证表单契约（SELECT / 刷新 / 布尔开关）。
  await clickOn('[data-testid="panel-frame-sessions"] button[title="新建连接"]');
  await waitFor(() => evaluate(`document.querySelector('#connection-protocol') !== null`), 5_000, '协议选择');
  await evaluate(setSelectScript('#connection-protocol', 'serial'));
  const serialFields = await waitFor(
    () =>
      evaluate(`(() => {
        const field = document.querySelector('[data-testid="connection-option-path"]');
        const refresh = document.querySelector('[data-testid="connection-option-path-refresh"]');
        const dtr = document.querySelector('[data-testid="connection-option-dtr"]');
        const baud = document.querySelector('[data-testid="connection-option-baudRate"]');
        const ending = document.querySelector('[data-testid="connection-option-lineEnding"]');
        if (!field || !refresh || !dtr || !baud || !ending) return null;
        return {
          tag: field.tagName,
          options: field.options.length,
          dtrType: dtr.type,
          dtrChecked: dtr.checked,
        };
      })()`),
    10_000,
    '串口字段渲染',
  );
  if (serialFields.tag !== 'SELECT') throw new Error('串口设备应渲染为下拉');
  if (serialFields.options < 1) throw new Error('串口设备下拉没有选项');
  if (serialFields.dtrType !== 'checkbox' || !serialFields.dtrChecked) {
    throw new Error(`串口 DTR 开关不正确：${JSON.stringify(serialFields)}`);
  }
  await shotOf('tmp/ssh-smoke-serial.png');
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.modal--form .button')];
    buttons.find((button) => button.textContent === '取消')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('.modal--form') === null`),
    5_000,
    '关闭串口表单',
  );

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
  await clickOn('.transfer-row[data-status="running"] [data-testid^="transfer-cancel-"]');
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
  // 面板常驻，无 SFTP 时文件面板显示不可用提示，而不是整个消失。
  const noSftpHint = String(
    await evaluate(
      `document.querySelector('[data-testid="panel-frame-files"] .file-panel__error')?.textContent ?? ''`,
    ),
  );
  if (!noSftpHint.includes('没有开启 SFTP')) {
    throw new Error(`无 SFTP 主机的文件面板应显示不可用提示，实际：${noSftpHint}`);
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
  if (error instanceof SwapDone) {
    console.log('SSH 交换验证通过：第二个 adapter 跑通连接 / 终端 / 文件，界面零改动，截图 tmp/ssh-swap.png');
    process.exitCode = 0;
  } else {
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
  }
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
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    echoServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
