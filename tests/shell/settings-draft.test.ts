import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../../src/services/config/schema.ts';
import { PREVIEW_FIELDS, isDirty, previewConfig } from '../../src/shell/settings-draft.ts';

test('settings_draft_dirty_flag', () => {
  const saved = defaultConfig();
  assert.equal(isDirty(defaultConfig(), saved), false);

  const draft = defaultConfig();
  draft.terminal.fontSize = 16;
  assert.equal(isDirty(draft, saved), true);

  const bindings = defaultConfig();
  bindings.shortcuts.overrides = { 'tab.close': null };
  assert.equal(isDirty(bindings, saved), true);
});

test('settings_preview_only_applies_appearance_fields', () => {
  const saved = defaultConfig();
  const draft = defaultConfig();
  draft.terminal.fontSize = 18;
  draft.terminal.fontFamily = 'menlo';
  draft.terminal.lineHeight = 1.35;
  draft.terminal.cursorStyle = 'bar';
  draft.terminal.cursorBlink = false;
  draft.terminal.scrollback = 10000;
  draft.terminal.showLineNumbers = false;
  draft.terminal.showTimestamps = false;
  draft.ui.theme = 'light';
  draft.ui.density = 'compact';
  draft.ssh.keepaliveInterval = 120;
  draft.transfer.concurrency = 4;
  draft.files.openByDefault = false;
  draft.shortcuts.overrides = { 'tab.close': null };

  const preview = previewConfig(draft, saved);

  // 预览字段跟草稿走。
  assert.equal(preview.terminal.fontSize, 18);
  assert.equal(preview.terminal.fontFamily, 'menlo');
  assert.equal(preview.terminal.lineHeight, 1.35);
  assert.equal(preview.terminal.cursorStyle, 'bar');
  assert.equal(preview.terminal.cursorBlink, false);
  assert.equal(preview.terminal.scrollback, 10000);
  assert.equal(preview.terminal.showLineNumbers, false);
  assert.equal(preview.terminal.showTimestamps, false);
  assert.equal(preview.ui.theme, 'light');
  assert.equal(preview.ui.density, 'compact');

  // 行为类字段在保存前保持已保存值。
  assert.equal(preview.ssh.keepaliveInterval, 30);
  assert.equal(preview.transfer.concurrency, 1);
  assert.equal(preview.files.openByDefault, true);
  assert.deepEqual(preview.shortcuts.overrides, {});
  // 已保存值不被修改。
  assert.equal(saved.terminal.fontSize, 13);
  assert.equal(saved.terminal.lineHeight, 1.2);
});

test('settings_preview_fields_cover_expected_paths', () => {
  assert.deepEqual([...PREVIEW_FIELDS], [
    'terminal.fontSize',
    'terminal.fontFamily',
    'terminal.lineHeight',
    'terminal.cursorStyle',
    'terminal.cursorBlink',
    'terminal.scrollback',
    'terminal.showLineNumbers',
    'terminal.showTimestamps',
    'ui.theme',
    'ui.density',
  ]);
});
