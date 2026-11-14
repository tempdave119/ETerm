import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandForShellPreset,
  detectShellPreset,
  type LocalShellPreset,
} from '../../src/shared/local-shell.ts';

test('local_shell_presets_map_to_commands', () => {
  const cases: Array<[LocalShellPreset, string]> = [
    ['system', ''],
    ['zsh', 'zsh -l'],
    ['bash', 'bash -l'],
    ['sh', 'sh -l'],
    ['custom', ''],
  ];
  for (const [preset, command] of cases) {
    assert.equal(commandForShellPreset(preset), command);
  }
});

test('local_shell_detects_known_and_custom_commands', () => {
  assert.equal(detectShellPreset(''), 'system');
  assert.equal(detectShellPreset('  '), 'system');
  assert.equal(detectShellPreset('zsh -l'), 'zsh');
  assert.equal(detectShellPreset('bash -l'), 'bash');
  assert.equal(detectShellPreset('sh -l'), 'sh');
  assert.equal(detectShellPreset('tmux attach -t work'), 'custom');
  assert.equal(detectShellPreset('bash -lc "echo hi"'), 'custom');
});
