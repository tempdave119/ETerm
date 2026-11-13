import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import ssh2 from 'ssh2';
import type { AddressInfo } from 'node:net';
import type { Connection } from 'ssh2';
import { ProductError } from '../../src/core/errors.ts';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { SessionService } from '../../src/core/session-service.ts';
import { sshModule } from '../../src/modules/ssh/index.ts';
import { fingerprintOf } from '../../src/modules/ssh/fingerprint.ts';

const { Server, utils } = ssh2;
const USERNAME = 'tester';
const PASSWORD = 'secret';

const hostKey = utils.generateKeyPairSync('ed25519');
const parsedPublicKey = utils.parseKey(hostKey.public);
if (parsedPublicKey instanceof Error) throw parsedPublicKey;
const HOST_FINGERPRINT = fingerprintOf(parsedPublicKey.getPublicSSH());

// 本地模拟服务器：只实现认证、pty、shell、exec，SFTP 明确拒绝，用来验证能力降级。
const connections = new Set<Connection>();
const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
  connections.add(client);
  client.on('close', () => connections.delete(client));
  // 客户端在握手／认证阶段主动断开时，服务器侧也会收到 error，避免未捕获异常。
  client.on('error', () => {});

  client.on('authentication', (context) => {
    if (context.method === 'password' && context.username === USERNAME && context.password === PASSWORD) {
      context.accept();
      return;
    }
    context.reject(['password']);
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();

      session.on('pty', (acceptPty) => {
        acceptPty();
      });
      session.on('window-change', () => {
        // window-change 是通告型请求，没有 accept 回调。
      });
      session.on('sftp', (_acceptSftp, rejectSftp) => {
        rejectSftp();
      });
      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        stream.write('mock$ ');
        stream.on('data', (chunk: Buffer) => {
          stream.write(chunk);
        });
      });
      session.on('exec', (acceptExec, _rejectExec, info) => {
        const stream = acceptExec();
        stream.write(`exec:${info.command}\n`);
        stream.exit(0);
        stream.end();
      });
    });
  });
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const { port } = server.address() as AddressInfo;

after(async () => {
  // 失败用例（指纹 / 认证）会留下服务器侧半开连接，收尾时统一断开，避免测试进程挂住。
  for (const connection of connections) connection.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
});

function createRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(sshModule);
  registry.setupAll();
  return registry;
}

function makeTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: '127.0.0.1',
    port,
    username: USERNAME,
    password: PASSWORD,
    hostKeyFingerprint: HOST_FINGERPRINT,
    ...overrides,
  };
}

async function openDirect(overrides: Record<string, unknown> = {}) {
  const registry = createRegistry();
  const module = registry.moduleForProtocol('ssh');
  assert.ok(module.exports.openSession);
  const handle = await module.exports.openSession({
    protocol: 'ssh',
    cols: 80,
    rows: 24,
    target: makeTarget(overrides),
  });
  return handle;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('等待超时');
}

test('ssh_service_routes_session_and_reports_capabilities', async () => {
  const registry = createRegistry();
  const service = new SessionService(registry, { onData: () => {}, onExit: () => {} });

  const opened = await service.open({ protocol: 'ssh', cols: 80, rows: 24, target: makeTarget() });

  // 模拟服务器拒绝 SFTP，能力集合必须如实降级。
  assert.deepEqual(opened.capabilities, ['session', 'exec']);
  service.close(opened.sessionId);
});

test('ssh_first_connect_without_fingerprint_asks_for_confirmation', async () => {
  await assert.rejects(
    openDirect({ hostKeyFingerprint: undefined }),
    (error: unknown) =>
      error instanceof ProductError &&
      error.code === 'HOST_KEY_CHANGED' &&
      error.message === '首次连接需要确认主机指纹' &&
      (error.detail ?? '').includes('SHA256:'),
  );
});

test('ssh_changed_fingerprint_is_rejected', async () => {
  await assert.rejects(
    openDirect({ hostKeyFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
    (error: unknown) => error instanceof ProductError && error.code === 'HOST_KEY_CHANGED',
  );
});

test('ssh_bad_password_maps_to_auth_failed', async () => {
  await assert.rejects(
    openDirect({ password: 'wrong' }),
    (error: unknown) => error instanceof ProductError && error.code === 'AUTH_FAILED',
  );
});

test('ssh_session_streams_input_and_output', async () => {
  const handle = await openDirect();
  const chunks: string[] = [];
  handle.session.onData((data) => chunks.push(data));

  assert.match(chunks.join(''), /mock\$ /);
  handle.session.write('hello\r');
  await waitFor(() => chunks.join('').includes('hello'));

  handle.session.resize(120, 40);
  handle.session.close();
});

test('ssh_exec_returns_stdout_and_exit_code', async () => {
  const handle = await openDirect();
  assert.ok(handle.exec);

  const result = await handle.exec.exec('uname -a');

  assert.equal(result.stdout.trim(), 'exec:uname -a');
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  handle.session.close();
});
