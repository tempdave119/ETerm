/**
 * 命令的界面辅助：匹配、过滤与展示。
 * 命令数据在 shared/commands.ts，主进程菜单与渲染层键盘分发共用同一份。
 */

import { COMMANDS, type CommandDefinition, type CommandId } from '../../shared/commands.ts';
import { t } from '../../shared/i18n/index.ts';
import type { ShortcutSpec } from '../../shared/shortcut.ts';

export { COMMANDS };
export type { CommandDefinition, CommandId, ShortcutSpec };

export interface KeyEventLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const COMMAND_BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));

export function commandById(id: CommandId): CommandDefinition | null {
  return COMMAND_BY_ID.get(id) ?? null;
}

export function matchesShortcut(event: KeyEventLike, shortcut: ShortcutSpec): boolean {
  if (event.altKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  return event.code === shortcut.code;
}

/** 命令面板过滤：标题与关键词都参与，空查询返回全部。 */
export function commandTitle(command: CommandDefinition): string {
  return command.titleKey ? t(command.titleKey) : (command.title ?? command.id);
}

export function commandGroup(command: CommandDefinition): string {
  return command.groupKey ? t(command.groupKey) : t('command.group.plugin');
}

export function filterCommands(
  query: string,
  commands: readonly CommandDefinition[] = COMMANDS,
): CommandDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((command) =>
    [commandTitle(command), ...command.keywords].some((text) => text.toLowerCase().includes(needle)),
  );
}

/** 展示用快捷键：⌘T / ⌘⇧D / ⌘, / ⌘⇧[ */
export function shortcutLabel(shortcut: ShortcutSpec): string {
  const key = keyLabel(shortcut.code);
  return `⌘${shortcut.shift ? '⇧' : ''}${key}`;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const symbols: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Space: 'Space',
    Enter: '↩',
    Tab: '⇥',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backspace: '⌫',
    Delete: '⌦',
  };
  return symbols[code] ?? code;
}
