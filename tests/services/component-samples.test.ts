import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installComponentSamples,
  listComponentSamples,
  uninstallComponentSamples,
  type ComponentSampleDirs,
} from '../../src/services/components/samples.ts';

async function withDirs(run: (dirs: ComponentSampleDirs) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'eterm-components-'));
  try {
    const dirs = { bundledDir: join(root, 'bundled'), userDir: join(root, 'user') };
    await mkdir(join(dirs.bundledDir, 'serial'), { recursive: true });
    await mkdir(join(dirs.bundledDir, 'telnet'), { recursive: true });
    await writeFile(
      join(dirs.bundledDir, 'serial', 'manifest.json'),
      JSON.stringify({
        id: 'serial',
        kind: 'capability',
        activation: { onProtocol: 'serial' },
        ui: { label: '串口' },
      }),
    );
    await writeFile(join(dirs.bundledDir, 'serial', 'index.cjs'), 'module.exports = {};\n');
    await writeFile(
      join(dirs.bundledDir, 'telnet', 'manifest.json'),
      JSON.stringify({
        id: 'telnet',
        kind: 'capability',
        activation: { onProtocol: 'telnet' },
        ui: { label: 'Telnet' },
      }),
    );
    await writeFile(join(dirs.bundledDir, 'telnet', 'index.cjs'), 'module.exports = {};\n');
    await run(dirs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('component_samples_lists_bundled_samples_as_uninstalled', async () => {
  await withDirs(async (dirs) => {
    const samples = await listComponentSamples(dirs);
    assert.deepEqual(
      samples.map((sample) => [sample.id, sample.protocol, sample.installed]),
      [
        ['serial', 'serial', false],
        ['telnet', 'telnet', false],
      ],
    );
  });
});

test('component_samples_installs_and_is_idempotent', async () => {
  await withDirs(async (dirs) => {
    const first = await installComponentSamples(dirs);
    assert.deepEqual(first.installed, ['serial', 'telnet']);
    assert.deepEqual(first.skipped, []);
    assert.match(await readFile(join(dirs.userDir, 'serial', 'index.cjs'), 'utf8'), /module\.exports/);
    assert.match(await readFile(join(dirs.userDir, 'telnet', 'index.cjs'), 'utf8'), /module\.exports/);

    const second = await installComponentSamples(dirs);
    assert.deepEqual(second.installed, []);
    assert.deepEqual(second.skipped, ['serial', 'telnet']);
    assert.ok((await listComponentSamples(dirs)).every((sample) => sample.installed));
  });
});

test('component_samples_uninstalls_only_bundled_and_installed_ids', async () => {
  await withDirs(async (dirs) => {
    await installComponentSamples(dirs);

    const result = await uninstallComponentSamples(dirs, ['serial', 'unknown', '../serial']);
    assert.deepEqual(result.removed, ['serial']);
    assert.deepEqual(result.skipped, ['unknown', '../serial']);
    assert.ok((await listComponentSamples(dirs)).find((sample) => sample.id === 'serial')?.installed === false);
    assert.ok((await listComponentSamples(dirs)).find((sample) => sample.id === 'telnet')?.installed === true);
    await assert.rejects(readFile(join(dirs.userDir, 'serial', 'manifest.json')));
  });
});

test('component_samples_reinstalls_after_uninstall_by_id', async () => {
  await withDirs(async (dirs) => {
    await installComponentSamples(dirs);
    await uninstallComponentSamples(dirs, ['serial']);

    const result = await installComponentSamples(dirs, ['serial']);
    assert.deepEqual(result.installed, ['serial']);
    assert.deepEqual(result.skipped, []);
    const serial = (await listComponentSamples(dirs)).find((sample) => sample.id === 'serial');
    assert.equal(serial?.installed, true);
    assert.match(await readFile(join(dirs.userDir, 'serial', 'index.cjs'), 'utf8'), /module\.exports/);
  });
});

test('component_samples_skips_unknown_install_id', async () => {
  await withDirs(async (dirs) => {
    const result = await installComponentSamples(dirs, ['unknown']);
    assert.deepEqual(result.installed, []);
    assert.deepEqual(result.skipped, ['unknown']);
  });
});

test('component_samples_does_not_overwrite_existing_component', async () => {
  await withDirs(async (dirs) => {
    await mkdir(join(dirs.userDir, 'serial'), { recursive: true });
    await writeFile(
      join(dirs.userDir, 'serial', 'manifest.json'),
      JSON.stringify({ id: 'serial', kind: 'capability', activation: { onProtocol: 'serial' } }),
    );
    await writeFile(join(dirs.userDir, 'serial', 'index.cjs'), '// user modified\n');

    const result = await installComponentSamples(dirs);
    assert.deepEqual(result.installed, ['telnet']);
    assert.deepEqual(result.skipped, ['serial']);
    assert.equal(await readFile(join(dirs.userDir, 'serial', 'index.cjs'), 'utf8'), '// user modified\n');
  });
});
