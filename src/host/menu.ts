/**
 * 应用菜单模板：纯函数，主进程装配与单测共用。
 * accelerator 跟随用户改键（config.shortcuts.overrides），改完重建菜单即可同步。
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { CommandId } from '../shared/commands.ts';
import type { MenuCommand } from '../shared/ipc.ts';
import type { ResolvedShortcuts, ShortcutSpec } from '../shared/shortcut.ts';

/** event.code 转 Electron accelerator；不认识的键返回 undefined（菜单项不带快捷键）。 */
export function shortcutToAccelerator(spec: ShortcutSpec | null | undefined): string | undefined {
  if (!spec) return undefined;
  const key = acceleratorKey(spec.code);
  if (!key) return undefined;
  return `CommandOrControl+${spec.shift ? 'Shift+' : ''}${key}`;
}

function acceleratorKey(code: string): string | null {
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
    Enter: 'Return',
    Tab: 'Tab',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backspace: 'Backspace',
    Delete: 'Delete',
  };
  if (symbols[code]) return symbols[code];
  return /^F\d{1,2}$/.test(code) ? code : null;
}

export interface MenuActions {
  run(command: MenuCommand): void;
  /** 帮助菜单：在 Finder 中打开用户数据目录。 */
  openDataDir(): void;
  showAbout(): void;
}

export function buildMenuTemplate(
  shortcuts: ResolvedShortcuts,
  actions: MenuActions,
  appName = 'ETerm',
): MenuItemConstructorOptions[] {
  const { run } = actions;
  const accel = (id: CommandId): string | undefined => shortcutToAccelerator(shortcuts[id]);

  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `关于 ${appName}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${appName}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${appName}` },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '新建终端', accelerator: accel('terminal.new'), click: () => run('terminal.new') },
        { label: '新建连接', accelerator: accel('connection.new'), click: () => run('connection.new') },
        { type: 'separator' },
        { label: '关闭标签', accelerator: accel('tab.close'), click: () => run('tab.close') },
      ],
    },
    {
      label: '编辑',
      // xterm 是 canvas 渲染，role 的 DOM 复制拿不到选区；而注册 ⌘C / ⌘V 会抢走
      // 输入框里的系统复制粘贴。所以只做菜单入口，键盘路径留给终端与浏览器默认行为。
      submenu: [
        { label: '复制', click: () => run('edit.copy') },
        { label: '粘贴', click: () => run('edit.paste') },
        { label: '全选', click: () => run('edit.selectAll') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换文件面板', accelerator: accel('files.toggle'), click: () => run('files.toggle') },
        { label: '切换系统资源面板', accelerator: accel('panel.monitor'), click: () => run('panel.monitor') },
        { type: 'separator' },
        { label: '左右分屏', accelerator: accel('pane.split-row'), click: () => run('pane.split-row') },
        { label: '上下分屏', accelerator: accel('pane.split-column'), click: () => run('pane.split-column') },
        { label: '关闭当前窗格', accelerator: accel('pane.close'), click: () => run('pane.close') },
        { type: 'separator' },
        { label: '端口转发…', accelerator: accel('forward.open'), click: () => run('forward.open') },
        { label: '设置…', accelerator: accel('settings.open'), click: () => run('settings.open') },
        { label: '命令面板…', accelerator: accel('palette.open'), click: () => run('palette.open') },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '打开配置目录', click: () => actions.openDataDir() },
        { type: 'separator' },
        { label: `关于 ${appName}`, click: () => actions.showAbout() },
      ],
    },
  ];
}
