import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LayoutStore } from '../../src/services/layouts/store.ts';
import type { LayoutTemplate } from '../../src/shared/layout-template.ts';

async function createStore() {
  const dir = join(process.cwd(), 'tmp', 'tests', `layouts-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return { dir, store: new LayoutStore({ baseDir: dir, logger: () => {} }) };
}

const splitTemplate: LayoutTemplate = {
  type: 'split',
  direction: 'row',
  ratio: 0.6,
  first: { type: 'leaf' },
  second: { type: 'leaf' },
};

test('layouts_panels_default_when_file_missing', async () => {
  const { store } = await createStore();

  assert.deepEqual(await store.getPanels(), { files: true, monitor: false });
});

test('layouts_panels_persist_without_touching_splits', async () => {
  const { dir, store } = await createStore();
  await store.save('conn-1', splitTemplate);
  await store.savePanels({ files: false, monitor: true });

  const reloaded = new LayoutStore({ baseDir: dir, logger: () => {} });
  assert.deepEqual(await reloaded.getPanels(), { files: false, monitor: true });
  assert.deepEqual(await reloaded.get('conn-1'), splitTemplate);
});

test('layouts_old_file_without_panels_falls_back_to_defaults', async () => {
  const { dir } = await createStore();
  await writeFile(join(dir, 'layout.json'), JSON.stringify({ version: 1, splits: {} }), 'utf8');

  const store = new LayoutStore({ baseDir: dir, logger: () => {} });
  assert.deepEqual(await store.getPanels(), { files: true, monitor: false });
});
