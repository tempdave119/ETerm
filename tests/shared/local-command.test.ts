import test from 'node:test';
import assert from 'node:assert/strict';
import { commandFromTarget, resolveLocalCommand } from '../../src/shared/local-command.ts';

test('resolve_local_command_empty_uses_login_shell', () => {
  assert.deepEqual(resolveLocalCommand('', '/bin/zsh'), { file: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(resolveLocalCommand('   ', '/bin/zsh'), { file: '/bin/zsh', args: ['-l'] });
  assert.deepEqual(resolveLocalCommand(undefined, '/bin/bash'), { file: '/bin/bash', args: ['-l'] });
  assert.deepEqual(resolveLocalCommand(null, '/bin/bash'), { file: '/bin/bash', args: ['-l'] });
});

test('resolve_local_command_wraps_custom_command_in_login_sh', () => {
  assert.deepEqual(resolveLocalCommand('bash -l', '/bin/zsh'), { file: '/bin/sh', args: ['-lc', 'bash -l'] });
  assert.deepEqual(resolveLocalCommand('  tmux attach  ', '/bin/zsh'), {
    file: '/bin/sh',
    args: ['-lc', 'tmux attach'],
  });
});

test('resolve_local_command_keeps_shell_syntax_untouched', () => {
  const command = 'cd "$HOME/projects" && exec zsh -l';
  const launch = resolveLocalCommand(command, '/bin/zsh');
  assert.equal(launch.file, '/bin/sh');
  assert.deepEqual(launch.args, ['-lc', command]);
});

test('resolve_local_command_reads_command_from_target', () => {
  assert.equal(commandFromTarget({ command: 'bash -l' }), 'bash -l');
  assert.equal(commandFromTarget({ command: 42 }), '');
  assert.equal(commandFromTarget({}), '');
  assert.equal(commandFromTarget(null), '');
  assert.equal(commandFromTarget('bash'), '');
});
