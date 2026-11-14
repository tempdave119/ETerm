import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPluginApiCompatible, parsePluginManifest, parsePluginPanelId, pluginPanelId, resolvePluginAsset } from '../../src/shared/plugins.ts';
import { PluginStore } from '../../src/services/plugins/store.ts';

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    kind: 'plugin',
    apiVersion: '^1.0.0',
    version: '0.1.0',
    description: 'demo plugin',
    author: 'tester',
    entry: 'index.cjs',
    ...overrides,
  };
}

async function createStore() {
  const base = join(process.cwd(), 'tmp', 'tests', `plugins-${randomUUID()}`);
  await mkdir(base, { recursive: true });
  const logs: string[] = [];
  const store = new PluginStore({ baseDir: join(base, 'data'), logger: (message) => logs.push(message) });
  return { base, logs, store };
}

async function writePlugin(directory: string, overrides: Record<string, unknown> = {}): Promise<string> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest(overrides)), 'utf8');
  await writeFile(join(directory, 'index.cjs'), 'module.exports = {};\n', 'utf8');
  return directory;
}

test('plugins_manifest_accepts_minimal_and_defaults', () => {
  const parsed = parsePluginManifest(manifest());

  assert.equal(parsed.id, 'demo');
  assert.equal(parsed.kind, 'plugin');
  assert.deepEqual(parsed.permissions, []);
  assert.deepEqual(parsed.panels, []);
  assert.deepEqual(parsed.commands, []);
  assert.deepEqual(parsed.themes, []);
});

test('plugins_manifest_rejects_wrong_kind', () => {
  assert.throws(() => parsePluginManifest(manifest({ kind: 'capability' })), /kind/);
});

test('plugins_manifest_rejects_entry_traversal', () => {
  assert.throws(() => parsePluginManifest(manifest({ entry: '../escape.cjs' })), /相对路径/);
  assert.throws(() => parsePluginManifest(manifest({ entry: '/abs.cjs' })), /相对路径/);
});

test('plugins_manifest_rejects_unknown_permission', () => {
  assert.throws(() => parsePluginManifest(manifest({ permissions: ['network'] })), /permissions/);
});

test('plugins_manifest_validates_panel_dock', () => {
  assert.throws(
    () => parsePluginManifest(manifest({ panels: [{ id: 's3', title: 'S3', defaultDock: 'top' }] })),
    /defaultDock/,
  );
  const parsed = parsePluginManifest(
    manifest({ panels: [{ id: 's3', title: 'S3', defaultDock: 'right' }] }),
  );
  assert.equal(parsed.panels[0]?.defaultDock, 'right');
});

test('plugins_api_version_checks_major_only', () => {
  assert.equal(isPluginApiCompatible('^1.9.0', '1'), true);
  assert.equal(isPluginApiCompatible('^2.0.0', '1'), false);
  assert.equal(isPluginApiCompatible('1.0.0', '1'), false);
});

test('plugins_store_installs_and_lists', async () => {
  const { base, store } = await createStore();
  const source = await writePlugin(join(base, 'source', 'demo'));

  const record = await store.install(source);
  const list = await store.list();

  assert.equal(record.id, 'demo');
  assert.equal(record.enabled, true);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 'demo');
  assert.equal(list[0]?.version, '0.1.0');
  const state = JSON.parse(await readFile(join(base, 'data', 'plugins.json'), 'utf8'));
  assert.deepEqual(state.disabled, []);
});

test('plugins_store_rejects_duplicate_install', async () => {
  const { base, store } = await createStore();
  const source = await writePlugin(join(base, 'source', 'demo'));
  await store.install(source);

  await assert.rejects(store.install(source), /插件已存在/);
});

test('plugins_store_rejects_missing_manifest', async () => {
  const { store } = await createStore();
  await assert.rejects(store.install(join(process.cwd(), 'tmp', 'not-a-plugin')), /manifest\.json/);
});

test('plugins_store_set_enabled_persists', async () => {
  const { base, store } = await createStore();
  await store.install(await writePlugin(join(base, 'source', 'demo')));

  await store.setEnabled('demo', false);
  let list = await store.list();
  assert.equal(list[0]?.enabled, false);
  let state = JSON.parse(await readFile(join(base, 'data', 'plugins.json'), 'utf8'));
  assert.deepEqual(state.disabled, ['demo']);

  await store.setEnabled('demo', true);
  list = await store.list();
  assert.equal(list[0]?.enabled, true);
  state = JSON.parse(await readFile(join(base, 'data', 'plugins.json'), 'utf8'));
  assert.deepEqual(state.disabled, []);
});

test('plugins_store_uninstall_removes_directory', async () => {
  const { base, store } = await createStore();
  await store.install(await writePlugin(join(base, 'source', 'demo')));

  await store.uninstall('demo');

  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.setEnabled('demo', false), /manifest\.json/);
});

test('plugins_store_skips_broken_manifest', async () => {
  const { base, logs, store } = await createStore();
  await mkdir(join(base, 'data', 'plugins', 'broken'), { recursive: true });
  await writeFile(join(base, 'data', 'plugins', 'broken', 'manifest.json'), '{ 坏 JSON', 'utf8');

  const list = await store.list();

  assert.deepEqual(list, []);
  assert.ok(logs.some((line) => line.includes('插件已跳过')));
});

test('plugins_store_rejects_incompatible_api', async () => {
  const { base, store } = await createStore();
  const source = await writePlugin(join(base, 'source', 'demo'), { apiVersion: '^9.0.0' });

  await assert.rejects(store.install(source), /不兼容/);
});

test('plugins_panel_ids_roundtrip', () => {
  assert.equal(pluginPanelId('demo', 's3'), 'plugin:demo:s3');
  assert.deepEqual(parsePluginPanelId('plugin:demo:s3'), { pluginId: 'demo', panelId: 's3' });
  assert.equal(parsePluginPanelId('plugin:demo'), null);
  assert.equal(parsePluginPanelId('plugin:Demo:s3'), null);
  assert.equal(parsePluginPanelId('sessions'), null);
});

test('plugins_asset_path_rejects_traversal', () => {
  const root = '/tmp/plugins/demo';

  assert.equal(resolvePluginAsset(root, '/panel.html'), '/tmp/plugins/demo/panel.html');
  assert.equal(resolvePluginAsset(root, '/assets/app.js'), '/tmp/plugins/demo/assets/app.js');
  assert.equal(resolvePluginAsset(root, '/../secret'), null);
  assert.equal(resolvePluginAsset(root, '/a/../b'), null);
  assert.equal(resolvePluginAsset(root, '/a//b'), null);
  assert.equal(resolvePluginAsset(root, '/'), null);
});

test('plugins_store_panel_root_respects_enabled', async () => {
  const { base, store } = await createStore();
  await store.install(await writePlugin(join(base, 'source', 'demo')));

  const root = await store.panelRoot('demo');
  assert.ok(root?.endsWith(join('data', 'plugins', 'demo')));

  await store.setEnabled('demo', false);
  assert.equal(await store.panelRoot('demo'), null);
});