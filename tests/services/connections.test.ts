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
