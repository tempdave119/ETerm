/**
 * 应用菜单模板：纯函数，主进程装配与单测共用。
 * accelerator 跟随用户改键（config.shortcuts.overrides），改完重建菜单即可同步；
 * 文案走 t()，随界面语言重建。
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { CommandId } from '../shared/commands.ts';
import type { MenuCommand } from '../shared/ipc.ts';
import { t } from '../shared/i18n/index.ts';
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
        { role: 'about', label: t('menu.about', { name: appName }) },
        { type: 'separator' },
        { role: 'services', label: t('menu.services') },
        { type: 'separator' },
        { role: 'hide', label: t('menu.hide', { name: appName }) },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit', { name: appName }) },
      ],
    },
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newTerminal'), accelerator: accel('terminal.new'), click: () => run('terminal.new') },
        { label: t('menu.newConnection'), accelerator: accel('connection.new'), click: () => run('connection.new') },
        { type: 'separator' },
        { label: t('menu.closeTab'), accelerator: accel('tab.close'), click: () => run('tab.close') },
      ],
    },
    {
      label: t('menu.edit'),
      // xterm 是 canvas 渲染，role 的 DOM 复制拿不到选区；而注册 ⌘C / ⌘V 会抢走
      // 输入框里的系统复制粘贴。所以只做菜单入口，键盘路径留给终端与浏览器默认行为。
      submenu: [
        { label: t('common.copy'), click: () => run('edit.copy') },
        { label: t('common.paste'), click: () => run('edit.paste') },
        { label: t('common.selectAll'), click: () => run('edit.selectAll') },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.toggleFiles'), accelerator: accel('files.toggle'), click: () => run('files.toggle') },
        { label: t('menu.toggleMonitor'), accelerator: accel('panel.monitor'), click: () => run('panel.monitor') },
        { type: 'separator' },
        { label: t('menu.splitRow'), accelerator: accel('pane.split-row'), click: () => run('pane.split-row') },
        { label: t('menu.splitColumn'), accelerator: accel('pane.split-column'), click: () => run('pane.split-column') },
        { label: t('menu.closePane'), accelerator: accel('pane.close'), click: () => run('pane.close') },
        { type: 'separator' },
        { label: t('menu.forwards'), accelerator: accel('forward.open'), click: () => run('forward.open') },
        { label: t('menu.settings'), accelerator: accel('settings.open'), click: () => run('settings.open') },
        { label: t('menu.palette'), accelerator: accel('palette.open'), click: () => run('palette.open') },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        { type: 'separator' },
        { role: 'front', label: t('menu.front') },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.openDataDir'), click: () => actions.openDataDir() },
        { type: 'separator' },
        { label: t('menu.about', { name: appName }), click: () => actions.showAbout() },
      ],
    },
  ];
}
