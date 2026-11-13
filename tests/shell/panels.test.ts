import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCKABLE_PANEL_IDS,
  defaultPanelLayout,
  isPanelOpen,
  movePanel,
  panelDockOf,
  parsePanelLayout,
  removePanel,
  setDivider,
} from '../../src/shared/panels.ts';
import { PANELS, panelById, panelsInDock } from '../../src/shell/panels/registry.ts';

test('panels_registry_covers_six_unique_panels', () => {
  const ids = PANELS.map((panel) => panel.id);
  assert.equal(PANELS.length, 6);
  assert.equal(new Set(ids).size, ids.length);
  for (const panel of PANELS) {
    assert.ok(panel.title.length > 0, `${panel.id} 缺少标题`);
  }
});

test('panels_default_layout_matches_expected_docks', () => {
  const layout = defaultPanelLayout();
  assert.deepEqual(layout.docks.left, ['sessions']);
  assert.deepEqual(layout.docks.right, ['files']);
  assert.deepEqual(layout.docks.bottom, ['transfers']);
  assert.deepEqual(layout.dividers, { left: [], right: [], bottom: [] });
});

test('panels_in_dock_follows_user_layout_order', () => {
  const layout = defaultPanelLayout();
  layout.docks.right = ['monitor', 'files'];
  layout.dividers.right = [0.4];

  assert.deepEqual(panelsInDock(layout, 'right').map((panel) => panel.id), ['monitor', 'files']);
  assert.deepEqual(panelsInDock(layout, 'left').map((panel) => panel.id), ['sessions']);
});

test('panels_parse_migrates_legacy_boolean_state', () => {
  const legacy = parsePanelLayout({ files: true, monitor: true });
  assert.deepEqual(legacy.docks.right, ['files', 'monitor']);
  assert.equal(legacy.dividers.right.length, 1);

  const hidden = parsePanelLayout({ files: false, monitor: false });
  assert.deepEqual(hidden.docks.right, []);
});

test('panels_parse_rejects_unknown_and_duplicate_ids', () => {
  const layout = parsePanelLayout({
    docks: {
      left: ['files', 'ghost', 'files'],
      right: ['monitor', 'files'],
      bottom: ['transfers', 'settings'],
    },
    dividers: { left: [], right: [0.5], bottom: [] },
  });

  // ghost 与 settings 不是停靠面板；重复的 files 只保留第一次出现。
  assert.deepEqual(layout.docks.left, ['files']);
  assert.deepEqual(layout.docks.right, ['monitor']);
  assert.deepEqual(layout.docks.bottom, ['transfers']);
});

test('panels_parse_normalizes_invalid_dividers', () => {
  const layout = parsePanelLayout({
    docks: { left: [], right: ['files', 'monitor'], bottom: [] },
    dividers: { left: [], right: [0.99], bottom: [] },
  });

  assert.equal(layout.dividers.right.length, 1);
  assert.ok((layout.dividers.right[0] ?? 0) <= 0.85);
});

test('panels_move_between_docks', () => {
  const layout = defaultPanelLayout();
  const moved = movePanel(layout, 'monitor', 'left');

  assert.deepEqual(moved.docks.left, ['sessions', 'monitor']);
  assert.deepEqual(moved.docks.right, ['files']);
  assert.equal(panelDockOf(moved, 'monitor'), 'left');
  assert.equal(isPanelOpen(moved, 'monitor'), true);
});

test('panels_remove_closes_panel', () => {
  const layout = defaultPanelLayout();
  const closed = removePanel(layout, 'files');

  assert.deepEqual(closed.docks.right, []);
  assert.equal(isPanelOpen(closed, 'files'), false);
  // 关闭不存在的面板原样返回，不影响其他区。
  assert.deepEqual(removePanel(closed, 'monitor'), closed);
});

test('panels_set_divider_clamps_between_neighbors', () => {
  const layout = defaultPanelLayout();
  layout.docks.right = ['sessions', 'files', 'monitor'];
  layout.dividers.right = [0.4, 0.7];

  const tooHigh = setDivider(layout, 'right', 0, 0.95);
  assert.ok((tooHigh.dividers.right[0] ?? 0) <= 0.6);

  const tooLow = setDivider(layout, 'right', 1, 0.05);
  assert.ok((tooLow.dividers.right[1] ?? 0) >= 0.5);

  // 单面板没有分隔可改。
  assert.deepEqual(setDivider(defaultPanelLayout(), 'left', 0, 0.5).dividers.left, []);
});

test('panels_dockable_ids_cover_four_panels', () => {
  assert.deepEqual([...DOCKABLE_PANEL_IDS], ['sessions', 'files', 'monitor', 'transfers']);
  assert.equal(panelById('monitor')?.defaultDock, 'right');
});
