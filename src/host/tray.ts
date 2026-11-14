import { Menu, Tray, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MenuCommand } from '../shared/ipc.ts';

export interface TrayActions {
  showWindow(): void;
  run(command: MenuCommand): void;
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => actions.showWindow() },
      { type: 'separator' },
      { label: '新建终端', click: () => actions.run('terminal.new') },
      { label: '新建连接', click: () => actions.run('connection.new') },
      { type: 'separator' },
      { label: '退出 ETerm', role: 'quit' },
    ]),
  );
  return tray;
}
