/**
 * 命令定义：主进程菜单与渲染层键盘分发共用同一份。
 * 快捷键按 event.code 匹配，不受中文输入法与 Shift 后符号变化影响；
 * 用户改键只改 config.shortcuts.overrides，不动这里的默认值。
 */

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
  title: string;
  group: string;
  keywords: string[];
  shortcut?: ShortcutSpec;
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
    id: 'forward.open',
    title: '端口转发',
    group: '连接',
    keywords: ['forward', 'tunnel', 'port', '转发', '隧道'],
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
