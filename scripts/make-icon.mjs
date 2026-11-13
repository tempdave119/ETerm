import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把 assets/icon.svg 渲染成 1024×1024 的 PNG（保留圆角外的透明区域），
 * 再按 macOS 图标规范生成 icon.icns（16 到 1024 完整尺寸集）。
 * 用法：npm run icon
 *
 * 注意：不能在顶层 await app.whenReady()，ESM 顶层 await 会阻塞主进程事件循环，
 * app 永远进不了 ready；必须放进 .then() 回调里。
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

app.whenReady().then(async () => {
  const svg = await readFile(join(root, 'assets', 'icon.svg'), 'utf8');

  // capturePage 在 transparent / offscreen / show:false 下都会挂起，
  // 改为 CDP 截图，用 setDefaultBackgroundColorOverride 拿到 alpha 通道。
  const win = new BrowserWindow({ width: 1024, height: 1024, show: true });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:1024px;height:1024px}
  </style></head><body>${svg}</body></html>`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 600));

  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await win.webContents.debugger.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1024, height: 1024, scale: 1 },
  });

  await mkdir(join(root, 'assets'), { recursive: true });
  const pngPath = join(root, 'assets', 'icon.png');
  await writeFile(pngPath, Buffer.from(shot.data, 'base64'));
  console.log('图标已生成：assets/icon.png（1024×1024，透明背景）');

  // electron-builder 只认 icns / 足够大的 png；iconset 是 iconutil 要求的中间目录。
  const iconset = join(root, 'tmp', 'icon.iconset');
  await mkdir(iconset, { recursive: true });
  const sizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of sizes) {
    execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)], {
      stdio: 'ignore',
    });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'assets', 'icon.icns')]);
  console.log('图标已生成：assets/icon.icns（16–1024 全套）');

  win.destroy();
  app.quit();
});
