import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ProductError } from '../../src/core/errors.ts';
import { resolveOpenOptions, type ResolverDeps } from '../../src/host/resolve-connection.ts';
import type { SshTarget } from '../../src/modules/ssh/target.ts';
import { ConnectionStore } from '../../src/services/connections/store.ts';

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function createStore() {
  const dir = join(process.cwd(), 'tmp', 'tests', `resolve-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return new ConnectionStore({ baseDir: dir, logger: () => {} });
}

function makeDeps(overrides: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    connections: { getConnection: async () => null },
    credentials: { get: async () => null },
    knownHosts: { get: async () => null },
    env: {},
    homeDir: '/home/tester',
    readKeyFile: async () => 'PRIVATE-KEY',
    ...overrides,
  };
}

test('resolve_password_connection_builds_ssh_target', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'web',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
  });

  const options = await resolveOpenOptions(
    { connectionId: connection.id, cols: 80, rows: 24 },
    makeDeps({
      connections: store,
      credentials: { get: async (_id, kind) => (kind === 'password' ? 'secret' : null) },
      knownHosts: { get: async () => FINGERPRINT },
    }),
  );

  assert.equal(options.protocol, 'ssh');
  const target = options.target as SshTarget;
  assert.equal(target.host, '10.0.0.1');
  assert.equal(target.port, 22);
  assert.equal(target.username, 'root');
  assert.equal(target.password, 'secret');
  assert.equal(target.hostKeyFingerprint, FINGERPRINT);
});

test('resolve_missing_password_is_reported', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'web',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
  });

  await assert.rejects(
    resolveOpenOptions({ connectionId: connection.id, cols: 80, rows: 24 }, makeDeps({ connections: store })),
    (error: unknown) =>
      error instanceof ProductError && error.code === 'AUTH_FAILED' && error.message === '这个连接还没有保存密码',
  );
});

test('resolve_key_connection_reads_key_and_passphrase', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'key-box',
    protocol: 'ssh',
    host: '10.0.0.2',
    username: 'root',
    auth: 'key',
    keyPath: '~/keys/id_ed25519',
  });
  const readPaths: string[] = [];

  const options = await resolveOpenOptions(
    { connectionId: connection.id, cols: 80, rows: 24 },
    makeDeps({
      connections: store,
      credentials: { get: async (_id, kind) => (kind === 'passphrase' ? 'key-pass' : null) },
      readKeyFile: async (path) => {
        readPaths.push(path);
        return 'PRIVATE-KEY';
      },
    }),
  );

  const target = options.target as SshTarget;
  assert.equal(target.privateKey, 'PRIVATE-KEY');
  assert.equal(target.passphrase, 'key-pass');
  assert.deepEqual(readPaths, ['/home/tester/keys/id_ed25519']);
});

test('resolve_key_read_failure_is_reported', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'key-box',
    protocol: 'ssh',
    host: '10.0.0.2',
    username: 'root',
    auth: 'key',
    keyPath: '/keys/missing',
  });

  await assert.rejects(
    resolveOpenOptions(
      { connectionId: connection.id, cols: 80, rows: 24 },
      makeDeps({
        connections: store,
        readKeyFile: async () => {
          throw new Error('ENOENT');
        },
      }),
    ),
    (error: unknown) => error instanceof ProductError && error.message === '私钥文件读取失败',
  );
});

test('resolve_relative_key_path_is_rejected', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'key-box',
    protocol: 'ssh',
    host: '10.0.0.2',
    username: 'root',
    auth: 'key',
    keyPath: 'keys/id_ed25519',
  });

  await assert.rejects(
    resolveOpenOptions({ connectionId: connection.id, cols: 80, rows: 24 }, makeDeps({ connections: store })),
    (error: unknown) => error instanceof ProductError && error.message === '私钥路径必须是绝对路径',
  );
});

test('resolve_agent_connection_uses_ssh_auth_sock', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'agent-box',
    protocol: 'ssh',
    host: '10.0.0.3',
    username: 'root',
    auth: 'agent',
  });

  const options = await resolveOpenOptions(
    { connectionId: connection.id, cols: 80, rows: 24 },
    makeDeps({ connections: store, env: { SSH_AUTH_SOCK: '/tmp/agent.sock' } }),
  );

  assert.equal((options.target as SshTarget).agent, '/tmp/agent.sock');
});

test('resolve_agent_without_socket_is_reported', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({
    name: 'agent-box',
    protocol: 'ssh',
    host: '10.0.0.3',
    username: 'root',
    auth: 'agent',
  });

  await assert.rejects(
    resolveOpenOptions({ connectionId: connection.id, cols: 80, rows: 24 }, makeDeps({ connections: store })),
    (error: unknown) => error instanceof ProductError && error.message === '没有可用的 SSH agent',
  );
});

test('resolve_local_connection_has_no_target', async () => {
  const store = await createStore();
  const connection = await store.saveConnection({ name: '本地', protocol: 'local' });

  const options = await resolveOpenOptions(
    { connectionId: connection.id, cols: 80, rows: 24 },
    makeDeps({ connections: store }),
  );

  assert.equal(options.protocol, 'local');
  assert.equal(options.target, undefined);
});

test('resolve_missing_connection_is_reported', async () => {
  const store = await createStore();

  await assert.rejects(
    resolveOpenOptions({ connectionId: 'nope', cols: 80, rows: 24 }, makeDeps({ connections: store })),
    (error: unknown) => error instanceof ProductError && error.message === '连接不存在',
  );
});
