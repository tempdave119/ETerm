import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS,
  commandById,
  filterCommands,
  matchesShortcut,
  shortcutLabel,
  type KeyEventLike,
} from '../../src/shell/commands/registry.ts';
import { findCommandByShortcut, resolveShortcuts } from '../../src/shell/commands/resolve.ts';

function keyEvent(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code: 'KeyA', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...overrides };
}

test('commands_have_unique_ids_and_shortcuts', () => {
  const ids = COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);

  const combos = COMMANDS.filter((command) => command.shortcut).map(
    (command) => `${command.shortcut!.code}+${String(Boolean(command.shortcut!.shift))}`,
  );
  assert.equal(new Set(combos).size, combos.length);
});

test('commands_every_entry_has_title_group_and_keywords', () => {
  for (const command of COMMANDS) {
    assert.ok(command.titleKey.length > 0, `${command.id} 缺少标题 key`);
    assert.ok(command.groupKey.length > 0, `${command.id} 缺少分组 key`);
    assert.ok(command.keywords.length > 0, `${command.id} 缺少关键词`);
  }
});

test('commands_lookup_by_id', () => {
  assert.equal(commandById('settings.open')?.titleKey, 'command.settings.open');
  assert.equal(commandById('palette.open')?.groupKey, 'command.group.palette');
});

test('commands_shortcut_matches_meta_and_ctrl_but_not_alt', () => {
  assert.equal(matchesShortcut(keyEvent({ code: 'KeyT' }), { code: 'KeyT' }), true);
  assert.equal(matchesShortcut(keyEvent({ code: 'KeyT', metaKey: false, ctrlKey: true }), { code: 'KeyT' }), true);
  assert.equal(matchesShortcut(keyEvent({ code: 'KeyT', altKey: true }), { code: 'KeyT' }), false);
  assert.equal(matchesShortcut(keyEvent({ code: 'KeyT' }), { code: 'KeyT', shift: true }), false);
});

test('commands_shortcut_finds_shift_and_symbol_combinations', () => {
  const defaults = resolveShortcuts({});
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyD' }), defaults)?.id, 'pane.split-row');
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyD', shiftKey: true }), defaults)?.id, 'pane.split-column');
  assert.equal(findCommandByShortcut(keyEvent({ code: 'Comma' }), defaults)?.id, 'settings.open');
  assert.equal(findCommandByShortcut(keyEvent({ code: 'BracketLeft', shiftKey: true }), defaults)?.id, 'tab.prev');
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyT', shiftKey: true }), defaults), null);
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyT', metaKey: false }), defaults), null);
});

test('commands_filter_matches_title_and_keywords', () => {
  assert.equal(filterCommands('').length, COMMANDS.length);
  assert.deepEqual(filterCommands('设置').map((command) => command.id), ['settings.open']);
  assert.deepEqual(
    filterCommands('split').map((command) => command.id),
    ['pane.close', 'pane.split-row', 'pane.split-column'],
  );
  assert.deepEqual(filterCommands('不存在的命令'), []);
});

test('commands_shortcut_label_formats_meta_shift_symbols', () => {
  assert.equal(shortcutLabel({ code: 'KeyT' }), '⌘T');
  assert.equal(shortcutLabel({ code: 'KeyD', shift: true }), '⌘⇧D');
  assert.equal(shortcutLabel({ code: 'Comma' }), '⌘,');
  assert.equal(shortcutLabel({ code: 'BracketRight', shift: true }), '⌘⇧]');
});
