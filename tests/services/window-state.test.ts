import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowStateStore, emptyWindowState, parseWindowState } from '../../src/services/window-state/store.ts';

test('window_state_parses_valid_state', () => {
  const state = parseWindowState({
    bounds: { x: 100, y: 80, width: 1080, height: 720 },
    maximized: true,
  });
  assert.deepEqual(state, {
    bounds: { x: 100, y: 80, width: 1080, height: 720 },
    maximized: true,
  });
});

test('window_state_invalid_bounds_fall_back_to_null', () => {
  assert.deepEqual(parseWindowState({ bounds: { width: 100 } }), emptyWindowState());
  assert.deepEqual(parseWindowState({ bounds: { x: 0, y: 0, width: 700, height: 400 } }), emptyWindowState());
  assert.deepEqual(parseWindowState('bad'), emptyWindowState());
});

test('window_state_store_round_trips_bounds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eterm-window-state-'));
  try {
    const store = new WindowStateStore({ baseDir: dir });
    await store.save({ bounds: { x: 40, y: 60, width: 1080, height: 720 }, maximized: false });

    const raw = JSON.parse(await readFile(join(dir, 'window-state.json'), 'utf8')) as unknown;
    assert.deepEqual(parseWindowState(raw), {
      bounds: { x: 40, y: 60, width: 1080, height: 720 },
      maximized: false,
    });
    assert.deepEqual(await new WindowStateStore({ baseDir: dir }).load(), {
      bounds: { x: 40, y: 60, width: 1080, height: 720 },
      maximized: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
