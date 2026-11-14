import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { t } from '../shared/i18n/index.ts';
import type { MenuCommand } from '../shared/ipc.ts';

export interface TrayActions {
  showWindow(): void;
  run(command: MenuCommand): void;
}

/** 托盘菜单单独导出：语言切换时主进程重建菜单会顺带刷新它。 */
export function buildTrayMenu(actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: t('tray.showWindow'), click: () => actions.showWindow() },
    { type: 'separator' },
    { label: t('menu.newTerminal'), click: () => actions.run('terminal.new') },
    { label: t('menu.newConnection'), click: () => actions.run('connection.new') },
    { type: 'separator' },
    { label: t('tray.quit', { name: 'ETerm' }), role: 'quit' },
  ];
}

/**
 * 菜单栏图标：模板图由系统按深浅色自动反色。
 * 图标缺失时返回 null，不影响应用启动（缺资源不算致命错误）。
 */
export function createAppTray(actions: TrayActions): Tray | null {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png');
  if (!existsSync(iconPath)) return null;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return null;
  image.setTemplateImage(true);

  const tray = new Tray(image);
  tray.setToolTip('ETerm');
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(actions)));
  return tray;
}
