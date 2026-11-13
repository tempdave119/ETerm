/**
 * 命令注册表：快捷键、命令面板与改键共用唯一一份定义。
 * 快捷键按 event.code 匹配，不受中文输入法与 Shift 后符号变化影响；
 * 后续改键只需替换 shortcut 字段，不用动 App 的键盘分发。
 */

export type CommandId =
  | 'terminal.new'
  | 'connection.new'
  | 'tab.close'
  | 'tab.next'
  | 'tab.prev'
  | 'pane.close'
  | 'pane.split-row'
  | 'pane.split-column'
  | 'files.toggle'
  | 'panel.monitor'
  | 'settings.open'
  | 'palette.open';

export interface ShortcutSpec {
  /** KeyboardEvent.code，例如 KeyT / Comma / BracketLeft。 */
  code: string;
  shift?: boolean;
}

export interface CommandDefinition {
  id: CommandId;
  title: string;
  group: string;
  keywords: string[];
  shortcut?: ShortcutSpec;
}

export interface KeyEventLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'terminal.new',
    title: '新建终端',
    group: '终端',
    keywords: ['terminal', 'new', 'shell', '本地'],
    shortcut: { code: 'KeyT' },
  },
  {
    id: 'connection.new',
    title: '新建连接',
    group: '连接',
    keywords: ['connection', 'host', 'ssh', '主机'],
    shortcut: { code: 'KeyN' },
  },
  {
    id: 'tab.close',
    title: '关闭当前标签',
    group: '标签',
    keywords: ['tab', 'close', '关闭'],
    shortcut: { code: 'KeyW' },
  },
  {
    id: 'tab.next',
    title: '下一个标签',
    group: '标签',
    keywords: ['tab', 'next', '切换'],
    shortcut: { code: 'BracketRight', shift: true },
  },
  {
    id: 'tab.prev',
    title: '上一个标签',
    group: '标签',
    keywords: ['tab', 'prev', 'previous', '切换'],
    shortcut: { code: 'BracketLeft', shift: true },
  },
  {
    id: 'pane.close',
    title: '关闭当前窗格',
    group: '布局',
    keywords: ['pane', 'close', 'split', '窗格'],
    shortcut: { code: 'KeyW', shift: true },
  },
  {
    id: 'pane.split-row',
    title: '左右分屏',
    group: '布局',
    keywords: ['split', 'row', 'vertical', '分屏'],
    shortcut: { code: 'KeyD' },
  },
  {
    id: 'pane.split-column',
    title: '上下分屏',
    group: '布局',
    keywords: ['split', 'column', 'horizontal', '分屏'],
    shortcut: { code: 'KeyD', shift: true },
  },
  {
    id: 'files.toggle',
    title: '切换文件面板',
    group: '面板',
    keywords: ['files', 'panel', '文件', '面板'],
    shortcut: { code: 'KeyF', shift: true },
  },
  {
    id: 'panel.monitor',
    title: '切换系统资源面板',
    group: '面板',
    keywords: ['monitor', 'system', 'cpu', 'memory', '监控', '资源'],
    shortcut: { code: 'KeyM', shift: true },
  },
  {
    id: 'settings.open',
    title: '打开设置',
    group: '设置',
    keywords: ['settings', 'config', 'preferences', '设置', '配置'],
    shortcut: { code: 'Comma' },
  },
  {
    id: 'palette.open',
    title: '打开命令面板',
    group: '命令',
    keywords: ['command', 'palette', 'commands', '命令'],
    shortcut: { code: 'KeyK' },
  },
];

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

export function findCommandByShortcut(event: KeyEventLike): CommandDefinition | null {
  return COMMANDS.find((command) => command.shortcut && matchesShortcut(event, command.shortcut)) ?? null;
}

/** 命令面板过滤：标题与关键词都参与，空查询返回全部。 */
export function filterCommands(query: string): CommandDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...COMMANDS];
  return COMMANDS.filter((command) =>
    [command.title, ...command.keywords].some((text) => text.toLowerCase().includes(needle)),
  );
}

/** 展示用快捷键：⌘T / ⌘⇧D / ⌘, / ⌘⇧[ */
export function shortcutLabel(shortcut: ShortcutSpec): string {
  const key = keyLabel(shortcut.code);
  return `⌘${shortcut.shift ? '⇧' : ''}${key}`;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code === 'Comma') return ',';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  return code;
}
