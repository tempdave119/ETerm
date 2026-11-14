/** 本地终端默认 shell 预设；custom 仍由 terminal.localCommand 自由输入。 */

export type LocalShellPreset = 'system' | 'zsh' | 'bash' | 'sh' | 'custom';

export const LOCAL_SHELL_COMMANDS: Record<Exclude<LocalShellPreset, 'custom'>, string> = {
  system: '',
  zsh: 'zsh -l',
  bash: 'bash -l',
  sh: 'sh -l',
};

export function commandForShellPreset(preset: LocalShellPreset): string {
  return preset === 'custom' ? '' : LOCAL_SHELL_COMMANDS[preset];
}

export function detectShellPreset(command: string): LocalShellPreset {
  const trimmed = command.trim();
  if (!trimmed) return 'system';
  for (const [preset, value] of Object.entries(LOCAL_SHELL_COMMANDS)) {
    if (preset !== 'system' && trimmed === value) return preset as LocalShellPreset;
  }
  return 'custom';
}
