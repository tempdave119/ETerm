import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 托盘模板图：从 assets/trayTemplate.svg 渲染 32×32 透明 PNG，
 * 再缩出 16×16；macOS 按 @2x 约定自动加载，setTemplateImage 后随深浅色反色。
 * 用法：npm run icon:tray
 *
 * 与 make-icon.mjs 一样：不能在顶层 await app.whenReady()，ESM 顶层 await 会阻塞就绪。
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

app.whenReady().then(async () => {
  const svg = await readFile(join(root, 'assets', 'trayTemplate.svg'), 'utf8');
  const win = new BrowserWindow({ width: 32, height: 32, show: true });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:32px;height:32px}
  </style></head><body>${svg}</body></html>`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 600));

  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 32,
    height: 32,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await win.webContents.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 32, height: 32, scale: 1 },
  });

  const retinaPath = join(root, 'assets', 'trayTemplate@2x.png');
  await writeFile(retinaPath, Buffer.from(shot.data, 'base64'));
  execFileSync('sips', ['-z', '16', '16', retinaPath, '--out', join(root, 'assets', 'trayTemplate.png')], {
    stdio: 'ignore',
  });
  console.log('托盘图标已生成：assets/trayTemplate.png（16×16）与 trayTemplate@2x.png（32×32）');

  win.destroy();
  app.quit();
});
