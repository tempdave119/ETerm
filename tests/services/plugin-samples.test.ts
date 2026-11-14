import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPluginSamples, listPluginSamples, type PluginSampleDirs } from '../../src/services/plugins/samples.ts';

const MANIFEST = {
  id: 'sample-browser',
  kind: 'plugin',
  apiVersion: '^1.0.0',
  version: '0.1.0',
  description: '示例插件',
  author: 'ETerm',
  entry: 'index.cjs',
  permissions: ['panel'],
  panels: [{ id: 'browser', title: '示例' }],
};

async function withDirs(run: (dirs: PluginSampleDirs) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'eterm-plugin-samples-'));
  try {
    const dirs = { bundledDir: join(root, 'bundled'), userDir: join(root, 'user') };
    await mkdir(join(dirs.bundledDir, 'sample-browser'), { recursive: true });
    await writeFile(join(dirs.bundledDir, 'sample-browser', 'manifest.json'), JSON.stringify(MANIFEST));
    await writeFile(join(dirs.bundledDir, 'sample-browser', 'index.cjs'), 'module.exports = {};\n');
    await run(dirs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('plugin_samples_lists_bundled_samples_as_uninstalled', async () => {
  await withDirs(async (dirs) => {
    const samples = await listPluginSamples(dirs);
    assert.deepEqual(
      samples.map((sample) => [sample.id, sample.version, sample.installed]),
      [['sample-browser', '0.1.0', false]],
    );
  });
});

test('plugin_samples_installs_by_id_and_is_idempotent', async () => {
  await withDirs(async (dirs) => {
    const first = await installPluginSamples(dirs, ['sample-browser']);
    assert.deepEqual(first.installed, ['sample-browser']);
    assert.deepEqual(first.skipped, []);
    assert.match(await readFile(join(dirs.userDir, 'sample-browser', 'index.cjs'), 'utf8'), /module\.exports/);

    const second = await installPluginSamples(dirs, ['sample-browser']);
    assert.deepEqual(second.installed, []);
    assert.deepEqual(second.skipped, ['sample-browser']);
    assert.ok((await listPluginSamples(dirs)).every((sample) => sample.installed));
  });
});

test('plugin_samples_skips_unknown_id', async () => {
  await withDirs(async (dirs) => {
    const result = await installPluginSamples(dirs, ['unknown']);
    assert.deepEqual(result.installed, []);
    assert.deepEqual(result.skipped, ['unknown']);
  });
});

test('plugin_samples_does_not_overwrite_installed_plugin', async () => {
  await withDirs(async (dirs) => {
    await mkdir(join(dirs.userDir, 'sample-browser'), { recursive: true });
    await writeFile(join(dirs.userDir, 'sample-browser', 'manifest.json'), JSON.stringify(MANIFEST));
    await writeFile(join(dirs.userDir, 'sample-browser', 'index.cjs'), '// user modified\n');

    const result = await installPluginSamples(dirs);
    assert.deepEqual(result.installed, []);
    assert.deepEqual(result.skipped, ['sample-browser']);
    assert.equal(await readFile(join(dirs.userDir, 'sample-browser', 'index.cjs'), 'utf8'), '// user modified\n');
  });
});
