/**
 * 命令定义：主进程菜单与渲染层键盘分发共用同一份。
 * 快捷键按 event.code 匹配，不受中文输入法与 Shift 后符号变化影响；
 * 用户改键只改 config.shortcuts.overrides，不动这里的默认值。
 * 标题与分组只存 i18n key，界面按当前语言取文案。
 */

import type { MessageKey } from './i18n/index.ts';
import type { ShortcutSpec } from './shortcut.ts';

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
  | 'forward.open'
  | 'settings.open'
  | 'palette.open';

export interface CommandDefinition {
  id: CommandId;
  titleKey: MessageKey;
  groupKey: MessageKey;
  keywords: string[];
  shortcut?: ShortcutSpec;
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'terminal.new',
    titleKey: 'command.terminal.new',
    groupKey: 'command.group.terminal',
    keywords: ['terminal', 'new', 'shell', '本地'],
    shortcut: { code: 'KeyT' },
  },
  {
    id: 'connection.new',
    titleKey: 'command.connection.new',
    groupKey: 'command.group.connection',
    keywords: ['connection', 'host', 'ssh', '主机'],
    shortcut: { code: 'KeyN' },
  },
  {
    id: 'tab.close',
    titleKey: 'command.tab.close',
    groupKey: 'command.group.tab',
    keywords: ['tab', 'close', '关闭'],
    shortcut: { code: 'KeyW' },
  },
  {
    id: 'tab.next',
    titleKey: 'command.tab.next',
    groupKey: 'command.group.tab',
    keywords: ['tab', 'next', '切换'],
    shortcut: { code: 'BracketRight', shift: true },
  },
  {
    id: 'tab.prev',
    titleKey: 'command.tab.prev',
    groupKey: 'command.group.tab',
    keywords: ['tab', 'prev', 'previous', '切换'],
    shortcut: { code: 'BracketLeft', shift: true },
  },
  {
    id: 'pane.close',
    titleKey: 'command.pane.close',
    groupKey: 'command.group.layout',
    keywords: ['pane', 'close', 'split', '窗格'],
    shortcut: { code: 'KeyW', shift: true },
  },
  {
    id: 'pane.split-row',
    titleKey: 'command.pane.split-row',
    groupKey: 'command.group.layout',
    keywords: ['split', 'row', 'vertical', '分屏'],
    shortcut: { code: 'KeyD' },
  },
  {
    id: 'pane.split-column',
    titleKey: 'command.pane.split-column',
    groupKey: 'command.group.layout',
    keywords: ['split', 'column', 'horizontal', '分屏'],
    shortcut: { code: 'KeyD', shift: true },
  },
  {
    id: 'files.toggle',
    titleKey: 'command.files.toggle',
    groupKey: 'command.group.panel',
    keywords: ['files', 'panel', '文件', '面板'],
    shortcut: { code: 'KeyF', shift: true },
  },
  {
    id: 'panel.monitor',
    titleKey: 'command.panel.monitor',
    groupKey: 'command.group.panel',
    keywords: ['monitor', 'system', 'cpu', 'memory', '监控', '资源'],
    shortcut: { code: 'KeyM', shift: true },
  },
  {
    id: 'forward.open',
    titleKey: 'command.forward.open',
    groupKey: 'command.group.connection',
    keywords: ['forward', 'tunnel', 'port', '转发', '隧道'],
  },
  {
    id: 'settings.open',
    titleKey: 'command.settings.open',
    groupKey: 'command.group.settings',
    keywords: ['settings', 'config', 'preferences', '设置', '配置'],
    shortcut: { code: 'Comma' },
  },
  {
    id: 'palette.open',
    titleKey: 'command.palette.open',
    groupKey: 'command.group.palette',
    keywords: ['command', 'palette', 'commands', '命令'],
    shortcut: { code: 'KeyK' },
  },
];
