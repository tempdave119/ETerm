import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { ModuleRegistry } from '../core/registry.ts';
import { SessionService } from '../core/session-service.ts';
import { localTerminalModule } from '../modules/local-terminal/index.ts';
import { IPC } from '../shared/ipc.ts';
import { registerSessionIpc } from './ipc.ts';

app.setName('ETerm');

const registry = new ModuleRegistry();
registry.register(localTerminalModule);
registry.setupAll();

let disposeIpc: (() => void) | null = null;
let sessions: SessionService | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'ETerm',
    backgroundColor: '#16181c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const service = new SessionService(registry, {
    onData: (sessionId, data) => {
      if (!window.isDestroyed()) window.webContents.send(IPC.data, sessionId, data);
    },
    onExit: (sessionId, info) => {
      if (!window.isDestroyed()) window.webContents.send(IPC.exit, sessionId, info);
    },
  });
  sessions = service;
  disposeIpc = registerSessionIpc(service);

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    disposeIpc?.();
    disposeIpc = null;
    sessions?.dispose();
    sessions = null;
  });

  const devServerUrl = process.env.ETERM_DEV_SERVER_URL;
  const smoke = process.env.ETERM_SMOKE === '1';
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    if (smoke) url.searchParams.set('debug', '1');
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), smoke ? { query: { debug: '1' } } : undefined);
  }
}

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  sessions?.dispose();
  registry.dispose();
});
