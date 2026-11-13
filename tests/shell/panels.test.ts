import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCKABLE_PANEL_IDS,
  defaultPanelLayout,
  isPanelOpen,
  movePanel,
  movePanelWithinDock,
  panelDockOf,
  parsePanelLayout,
  removePanel,
  setDivider,
} from '../../src/shared/panels.ts';
import { PANELS, panelById, panelsInDock } from '../../src/shell/panels/registry.ts';

function assertDividers(actual: number[], expected: number[]): void {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    assert.ok(Math.abs((actual[index] ?? 0) - value) < 1e-9, `第 ${index} 个分隔应为 ${value}，实际 ${actual[index]}`);
  });
}

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

test('panels_move_within_dock_keeps_panel_ratios', () => {
  const layout = defaultPanelLayout();
  layout.docks.right = ['files', 'monitor'];
  layout.dividers.right = [0.4];

  const moved = movePanelWithinDock(layout, 'right', 'monitor', -1);

  assert.deepEqual(moved.docks.right, ['monitor', 'files']);
  // files 原来占 0.4，monitor 占 0.6；交换后比例跟面板走。
  assertDividers(moved.dividers.right, [0.6]);
});

test('panels_move_within_dock_three_panels', () => {
  const layout = defaultPanelLayout();
  layout.docks.right = ['files', 'monitor', 'transfers'];
  layout.dividers.right = [0.2, 0.7];

  const moved = movePanelWithinDock(layout, 'right', 'monitor', -1);

  assert.deepEqual(moved.docks.right, ['monitor', 'files', 'transfers']);
  // 原比例 [0.2, 0.5, 0.3] → 新顺序 [0.5, 0.2, 0.3]。
  assertDividers(moved.dividers.right, [0.5, 0.7]);
});

test('panels_move_within_dock_falls_back_to_uniform_dividers', () => {
  const layout = defaultPanelLayout();
  layout.docks.left = ['sessions', 'files', 'monitor'];
  layout.dividers.left = [];

  const moved = movePanelWithinDock(layout, 'left', 'monitor', -1);

  assert.deepEqual(moved.docks.left, ['sessions', 'monitor', 'files']);
  assertDividers(moved.dividers.left, [1 / 3, 2 / 3]);
});

test('panels_move_within_dock_is_noop_at_boundaries', () => {
  const layout = defaultPanelLayout();
  layout.docks.right = ['files', 'monitor'];
  layout.dividers.right = [0.4];

  assert.equal(movePanelWithinDock(layout, 'right', 'files', -1), layout);
  assert.equal(movePanelWithinDock(layout, 'right', 'monitor', 1), layout);
  assert.equal(movePanelWithinDock(layout, 'right', 'sessions', 1), layout);

  const single = defaultPanelLayout();
  assert.equal(movePanelWithinDock(single, 'right', 'files', 1), single);
});

test('panels_dockable_ids_cover_four_panels', () => {
  assert.deepEqual([...DOCKABLE_PANEL_IDS], ['sessions', 'files', 'monitor', 'transfers']);
  assert.equal(panelById('monitor')?.defaultDock, 'right');
});
