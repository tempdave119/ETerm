import test from 'node:test';
import assert from 'node:assert/strict';
import type { ThemeDefinition } from '../../src/shared/theme.ts';
import { resolveTheme, terminalThemeFor } from '../../src/shell/theme.ts';

const nord: ThemeDefinition = {
  id: 'nord',
  name: 'Nord',
  base: 'dark',
  ui: { '--bg-canvas': '#101820' },
  terminal: { background: '#101820' },
};

test('theme_resolve_builtin_preferences', () => {
  assert.deepEqual(resolveTheme('light', 'dark', [nord]), {
    base: 'light',
    definition: null,
    missing: false,
  });
  assert.deepEqual(resolveTheme('system', 'light', [nord]), {
    base: 'light',
    definition: null,
    missing: false,
  });
});

test('theme_resolve_external_uses_theme_base', () => {
  const resolved = resolveTheme('ext:nord', 'light', [nord]);
  assert.equal(resolved.base, 'dark');
  assert.equal(resolved.definition?.id, 'nord');
  assert.equal(resolved.missing, false);
});

test('theme_resolve_missing_external_falls_back_to_system', () => {
  const resolved = resolveTheme('ext:gone', 'light', [nord]);
  assert.equal(resolved.base, 'light');
  assert.equal(resolved.definition, null);
  assert.equal(resolved.missing, true);
});

test('theme_terminal_palette_merges_external_over_base', () => {
  const palette = terminalThemeFor('dark', nord);
  assert.equal(palette.background, '#101820');
  assert.equal(palette.foreground, '#e6e8eb', '未覆盖的终端颜色应保留内置兜底');
});
