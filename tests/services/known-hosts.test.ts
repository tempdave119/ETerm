import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KnownHostsStore } from '../../src/services/known-hosts/store.ts';

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function createStore() {
  const dir = join(process.cwd(), 'tmp', 'tests', `known-hosts-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return { dir, store: new KnownHostsStore({ baseDir: dir, logger: () => {} }) };
}

test('known_hosts_unknown_host_verifies_as_new', async () => {
  const { store } = await createStore();

  assert.equal(await store.get('example.com', 22), null);
  assert.equal(await store.verify('example.com', 22, FINGERPRINT), 'new');
});

test('known_hosts_remember_and_match_after_reload', async () => {
  const { dir, store } = await createStore();
  await store.remember('Example.COM', 22, FINGERPRINT);

  const reloaded = new KnownHostsStore({ baseDir: dir, logger: () => {} });

  assert.equal(await reloaded.get('example.com', 22), FINGERPRINT);
  assert.equal(await reloaded.verify('example.com', 22, FINGERPRINT), 'match');
});

test('known_hosts_changed_fingerprint_is_reported', async () => {
  const { store } = await createStore();
  await store.remember('example.com', 22, FINGERPRINT);

  const other = 'SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  assert.equal(await store.verify('example.com', 22, other), 'changed');
});

test('known_hosts_forget_removes_entry', async () => {
  const { store } = await createStore();
  await store.remember('example.com', 22, FINGERPRINT);

  await store.forget('example.com', 22);

  assert.equal(await store.get('example.com', 22), null);
});

test('known_hosts_ipv6_uses_bracketed_key', async () => {
  const { store } = await createStore();
  await store.remember('::1', 2222, FINGERPRINT);

  assert.equal(await store.get('::1', 2222), FINGERPRINT);
});

test('known_hosts_rejects_invalid_fingerprint', async () => {
  const { store } = await createStore();

  await assert.rejects(store.remember('example.com', 22, 'not-a-fingerprint'), /指纹格式无效/);
});

test('known_hosts_invalid_file_is_backed_up', async () => {
  const { dir, store } = await createStore();
  await writeFile(join(dir, 'known_hosts.json'), '{ broken', 'utf8');

  assert.equal(await store.get('example.com', 22), null);
  const files = await readdir(dir);
  assert.ok(files.some((name) => name.startsWith('known_hosts.json.broken-')));
});
