import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConnectionStore } from '../../src/services/connections/store.ts';

async function createStore() {
  const dir = join(process.cwd(), 'tmp', 'tests', `connections-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'connections.json');
  return { dir, filePath, store: new ConnectionStore({ baseDir: dir, logger: () => {} }) };
}

test('connections_missing_file_returns_empty_snapshot', async () => {
  const { store } = await createStore();

  const snapshot = await store.list();

  assert.deepEqual(snapshot, { groups: [], connections: [] });
});

test('connections_save_group_and_connection_persist_after_reload', async () => {
  const { dir, store } = await createStore();
  const group = await store.saveGroup({ name: '生产' });
  const connection = await store.saveConnection({
    name: 'web-01',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
    groupId: group.id,
  });

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();

  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0]?.name, '生产');
  assert.equal(snapshot.connections.length, 1);
  assert.equal(snapshot.connections[0]?.id, connection.id);
  assert.equal(snapshot.connections[0]?.host, '10.0.0.1');
  assert.equal(snapshot.connections[0]?.port, 22);
  assert.equal(snapshot.connections[0]?.auth, 'password');
  assert.equal(snapshot.connections[0]?.groupId, group.id);
  assert.equal(snapshot.connections[0]?.order, 0);
});

test('connections_update_keeps_created_at_and_order', async () => {
  const { store } = await createStore();
  const first = await store.saveConnection({ name: 'old', protocol: 'ssh', host: '10.0.0.1', username: 'root' });

  const updated = await store.saveConnection({
    id: first.id,
    name: 'new',
    protocol: 'ssh',
    host: '10.0.0.2',
    username: 'root',
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.name, 'new');
  assert.equal(updated.host, '10.0.0.2');
  assert.equal(updated.order, first.order);
  assert.equal(updated.createdAt, first.createdAt);
  assert.ok(updated.updatedAt.length > 0);
});

test('connections_delete_group_ungroups_connections', async () => {
  const { store } = await createStore();
  const group = await store.saveGroup({ name: '临时' });
  const connection = await store.saveConnection({
    name: 'box',
    protocol: 'ssh',
    host: '10.0.0.3',
    username: 'root',
    groupId: group.id,
  });

  await store.deleteGroup(group.id);
  const snapshot = await store.list();

  assert.equal(snapshot.groups.length, 0);
  assert.equal(snapshot.connections[0]?.id, connection.id);
  assert.equal(snapshot.connections[0]?.groupId, null);
});

test('connections_delete_connection_removes_record', async () => {
  const { store } = await createStore();
  const connection = await store.saveConnection({
    name: 'box',
    protocol: 'ssh',
    host: '10.0.0.4',
    username: 'root',
  });

  await store.deleteConnection(connection.id);

  assert.deepEqual((await store.list()).connections, []);
});

test('connections_invalid_json_is_backed_up_and_reset', async () => {
  const { dir, filePath, store } = await createStore();
  await writeFile(filePath, '{ 这不是 JSON', 'utf8');

  const snapshot = await store.list();
  const files = await readdir(dir);

  assert.deepEqual(snapshot, { groups: [], connections: [] });
  assert.ok(files.some((name) => name.startsWith('connections.json.broken-')));
});

test('connections_ssh_requires_host_and_username', async () => {
  const { store } = await createStore();

  await assert.rejects(
    store.saveConnection({ name: 'bad', protocol: 'ssh' }),
    /主机/,
  );
});

test('connections_unknown_group_is_rejected', async () => {
  const { store } = await createStore();

  await assert.rejects(
    store.saveConnection({
      name: 'box',
      protocol: 'ssh',
      host: '10.0.0.5',
      username: 'root',
      groupId: 'missing-group',
    }),
    /分组不存在/,
  );
});

test('connections_duplicate_group_name_is_rejected', async () => {
  const { store } = await createStore();
  await store.saveGroup({ name: '生产' });

  await assert.rejects(store.saveGroup({ name: '生产' }), /分组名已存在/);
});

test('connections_atomic_write_leaves_no_temp_files', async () => {
  const { dir, store } = await createStore();

  await store.saveConnection({ name: 'box', protocol: 'ssh', host: '10.0.0.6', username: 'root' });
  const files = await readdir(dir);

  assert.ok(files.includes('connections.json'));
  assert.ok(!files.some((name) => name.includes('.tmp-')));
  const raw = await readFile(join(dir, 'connections.json'), 'utf8');
  assert.match(raw, /"version": 1/);
});

test('connections_list_is_sorted_by_order', async () => {
  const { store } = await createStore();
  await store.saveConnection({ name: 'first', protocol: 'ssh', host: '10.0.0.7', username: 'root' });
  await store.saveConnection({ name: 'second', protocol: 'ssh', host: '10.0.0.8', username: 'root' });

  const snapshot = await store.list();

  assert.deepEqual(
    snapshot.connections.map((item) => item.name),
    ['first', 'second'],
  );
});

test('connections_reorder_updates_order_and_persists', async () => {
  const { dir, store } = await createStore();
  const first = await store.saveConnection({ name: 'first', protocol: 'ssh', host: '10.0.0.7', username: 'root' });
  const second = await store.saveConnection({ name: 'second', protocol: 'ssh', host: '10.0.0.8', username: 'root' });

  await store.reorderConnections([second.id, first.id]);
  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();

  assert.deepEqual(
    snapshot.connections.map((item) => item.name),
    ['second', 'first'],
  );
});

test('connections_reorder_requires_all_ids', async () => {
  const { store } = await createStore();
  const first = await store.saveConnection({ name: 'first', protocol: 'ssh', host: '10.0.0.7', username: 'root' });

  await assert.rejects(store.reorderConnections([]), /必须包含全部连接/);
  await assert.rejects(store.reorderConnections([first.id, 'missing']), /必须包含全部连接/);
});

test('connections_jump_reference_persists_and_rejects_cycles', async () => {
  const { dir, store } = await createStore();
  const jump = await store.saveConnection({ name: 'jump', protocol: 'ssh', host: '10.0.0.9', username: 'ops' });
  const target = await store.saveConnection({
    name: 'web',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
    jumpConnectionId: jump.id,
  });

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  assert.equal(snapshot.connections.find((item) => item.id === target.id)?.jumpConnectionId, jump.id);

  // 把跳板机指向目标本身，保存时就该被环检测拦住。
  await assert.rejects(
    store.saveConnection({
      id: jump.id,
      name: 'jump',
      protocol: 'ssh',
      host: '10.0.0.9',
      username: 'ops',
      jumpConnectionId: target.id,
    }),
    /跳板链存在循环/,
  );
});

test('connections_jump_self_and_local_are_rejected', async () => {
  const { store } = await createStore();
  const jump = await store.saveConnection({ name: 'jump', protocol: 'ssh', host: '10.0.0.9', username: 'ops' });

  await assert.rejects(
    store.saveConnection({
      id: jump.id,
      name: 'jump',
      protocol: 'ssh',
      host: '10.0.0.9',
      username: 'ops',
      jumpConnectionId: jump.id,
    }),
    /跳板机不能是自己/,
  );
  await assert.rejects(
    store.saveConnection({ name: 'local', protocol: 'local', jumpConnectionId: jump.id }),
    /本地终端不能设置跳板机/,
  );
  await assert.rejects(
    store.saveConnection({ name: 'bad', protocol: 'ssh', host: '10.0.0.1', username: 'root', jumpConnectionId: 'missing' }),
    /跳板机连接不存在/,
  );
});

test('connections_delete_jump_clears_references', async () => {
  const { dir, store } = await createStore();
  const jump = await store.saveConnection({ name: 'jump', protocol: 'ssh', host: '10.0.0.9', username: 'ops' });
  const target = await store.saveConnection({
    name: 'web',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
    jumpConnectionId: jump.id,
  });

  await store.deleteConnection(jump.id);

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  assert.equal(snapshot.connections.find((item) => item.id === target.id)?.jumpConnectionId, undefined);
});

test('connections_component_protocol_persists_options', async () => {
  const { dir, store } = await createStore();
  const connection = await store.saveConnection({
    name: 'serial',
    protocol: 'serial',
    options: { path: '/dev/ttys001', baudRate: '115200' },
  });

  assert.equal(connection.auth, 'none');

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  const found = snapshot.connections.find((item) => item.id === connection.id);
  assert.equal(found?.protocol, 'serial');
  assert.deepEqual(found?.options, { path: '/dev/ttys001', baudRate: '115200' });

  await assert.rejects(
    store.saveConnection({ name: 'bad', protocol: 'serial', jumpConnectionId: 'some-id' }),
    /可选组件连接不支持跳板或代理/,
  );
});

test('connections_proxy_persists_and_is_validated', async () => {
  const { dir, store } = await createStore();
  const connection = await store.saveConnection({
    name: 'web',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
    proxy: { type: 'socks5', host: '127.0.0.1', port: 1080 },
  });

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  assert.deepEqual(snapshot.connections.find((item) => item.id === connection.id)?.proxy, {
    type: 'socks5',
    host: '127.0.0.1',
    port: 1080,
  });

  await assert.rejects(
    store.saveConnection({ name: 'local', protocol: 'local', proxy: { type: 'http', host: '127.0.0.1', port: 8080 } }),
    /本地终端不能设置代理/,
  );
  await assert.rejects(
    store.saveConnection({
      name: 'bad',
      protocol: 'ssh',
      host: '10.0.0.1',
      username: 'root',
      proxy: { type: 'http', host: '127.0.0.1', port: 0 },
    }),
    /代理端口 必须是 1–65535 的整数/,
  );
});

test('connections_proxy_username_persists', async () => {
  const { dir, store } = await createStore();
  const connection = await store.saveConnection({
    name: 'web-auth',
    protocol: 'ssh',
    host: '10.0.0.1',
    username: 'root',
    proxy: { type: 'http', host: '127.0.0.1', port: 8080, username: 'proxy-user' },
  });

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  assert.deepEqual(snapshot.connections.find((item) => item.id === connection.id)?.proxy, {
    type: 'http',
    host: '127.0.0.1',
    port: 8080,
    username: 'proxy-user',
  });
});

test('connections_note_persists_and_is_optional', async () => {
  const { dir, store } = await createStore();

  const withNote = await store.saveConnection({
    name: 'with-note',
    protocol: 'ssh',
    host: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth: 'password',
    note: '生产环境，只读',
  });
  assert.equal(withNote.note, '生产环境，只读');

  const plain = await store.saveConnection({
    name: 'no-note',
    protocol: 'ssh',
    host: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth: 'password',
  });
  assert.equal(plain.note, undefined);

  const reloaded = new ConnectionStore({ baseDir: dir, logger: () => {} });
  const snapshot = await reloaded.list();
  assert.equal(snapshot.connections.find((item) => item.id === withNote.id)?.note, '生产环境，只读');

  await assert.rejects(
    store.saveConnection({
      name: 'too-long',
      protocol: 'ssh',
      host: '127.0.0.1',
      port: 22,
      username: 'tester',
      auth: 'password',
      note: 'x'.repeat(201),
    }),
    /备注/,
  );
});
