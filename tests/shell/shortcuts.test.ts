import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCommandByShortcut,
  findConflict,
  findConflictIds,
  resolveShortcuts,
  shortcutFromEvent,
} from '../../src/shell/commands/resolve.ts';
import { COMMANDS, type KeyEventLike } from '../../src/shell/commands/registry.ts';

function keyEvent(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code: 'KeyA', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...overrides };
}

test('shortcuts_default_resolution_matches_registry', () => {
  const resolved = resolveShortcuts({});
  for (const command of COMMANDS) {
    assert.deepEqual(resolved[command.id] ?? null, command.shortcut ?? null);
  }
  assert.deepEqual(resolved['tab.close'], { code: 'KeyW' });
  assert.deepEqual(resolved['pane.close'], { code: 'KeyW', shift: true });
});

test('shortcuts_override_replaces_and_unbind_clears', () => {
  const resolved = resolveShortcuts({ 'files.toggle': { code: 'KeyG', shift: true }, 'panel.monitor': null });
  assert.deepEqual(resolved['files.toggle'], { code: 'KeyG', shift: true });
  assert.equal(resolved['panel.monitor'], null);
  assert.deepEqual(resolved['tab.close'], { code: 'KeyW' });
});

test('shortcuts_dispatch_uses_overrides', () => {
  const resolved = resolveShortcuts({ 'files.toggle': { code: 'KeyG', shift: true } });
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyG', shiftKey: true }), resolved)?.id, 'files.toggle');
  assert.equal(findCommandByShortcut(keyEvent({ code: 'KeyF', shiftKey: true }), resolved), null);
});

test('shortcuts_conflict_detection_respects_shift', () => {
  const resolved = resolveShortcuts({});
  // 默认表内 ⌘W（关标签）与 ⌘⇧W（关窗格）不算冲突。
  assert.equal(findConflictIds(resolved).size, 0);

  const clashed = resolveShortcuts({ 'tab.next': { code: 'KeyT' } });
  const conflicts = findConflictIds(clashed);
  assert.ok(conflicts.has('tab.next'));
  assert.ok(conflicts.has('terminal.new'));
});

test('shortcuts_single_conflict_lookup', () => {
  const resolved = resolveShortcuts({});
  assert.equal(findConflict('terminal.new', { code: 'KeyT' }, resolved), null);
  assert.equal(findConflict('tab.next', { code: 'KeyN' }, resolved), 'connection.new');
  assert.equal(findConflict('tab.next', null, resolved), null);
});

test('shortcuts_unbound_entries_do_not_conflict', () => {
  const resolved = resolveShortcuts({ 'terminal.new': null, 'connection.new': { code: 'KeyT' } });
  assert.equal(findConflictIds(resolved).size, 0);
});

test('shortcuts_recording_requires_meta_and_rejects_reserved', () => {
  assert.deepEqual(shortcutFromEvent(keyEvent({ code: 'KeyG' })), { code: 'KeyG' });
  assert.deepEqual(shortcutFromEvent(keyEvent({ code: 'KeyG', shiftKey: true })), { code: 'KeyG', shift: true });
  assert.equal(shortcutFromEvent(keyEvent({ code: 'KeyG', metaKey: false })), null);
  assert.equal(shortcutFromEvent(keyEvent({ code: 'KeyG', ctrlKey: true })), null);
  assert.equal(shortcutFromEvent(keyEvent({ code: 'KeyG', altKey: true })), null);
  assert.equal(shortcutFromEvent(keyEvent({ code: 'KeyQ' })), null);
  assert.equal(shortcutFromEvent(keyEvent({ code: 'KeyM', shiftKey: true })), null);
  assert.equal(shortcutFromEvent(keyEvent({ code: 'Tab' })), null);
});
