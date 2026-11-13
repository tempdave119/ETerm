import test from 'node:test';
import assert from 'node:assert/strict';
import { PANELS, panelById, panelsInDock } from '../../src/shell/panels/registry.ts';

test('panels_registry_covers_six_unique_panels', () => {
  const ids = PANELS.map((panel) => panel.id);
  assert.equal(PANELS.length, 6);
  assert.equal(new Set(ids).size, ids.length);
  for (const panel of PANELS) {
    assert.ok(panel.title.length > 0, `${panel.id} 缺少标题`);
  }
});

test('panels_registry_docks_match_layout', () => {
  assert.deepEqual(panelsInDock('left', {}).map((panel) => panel.id), ['sessions']);
  assert.deepEqual(panelsInDock('right', {}).map((panel) => panel.id), ['files']);
  assert.deepEqual(panelsInDock('bottom', {}).map((panel) => panel.id), ['transfers']);
  assert.deepEqual(panelsInDock('overlay', {}), []);
});

test('panels_in_dock_respects_explicit_open_state', () => {
  assert.deepEqual(
    panelsInDock('right', { files: true, monitor: true }).map((panel) => panel.id),
    ['files', 'monitor'],
  );
  assert.deepEqual(panelsInDock('right', { files: false, monitor: false }), []);
  assert.deepEqual(panelsInDock('overlay', { commands: true }).map((panel) => panel.id), ['commands']);
});

test('panels_lookup_by_id', () => {
  assert.equal(panelById('monitor')?.title, '系统资源');
  assert.equal(panelById('files')?.dock, 'right');
});
