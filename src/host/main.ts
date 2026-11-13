import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { ModuleRegistry } from '../core/registry.ts';
import { SessionService } from '../core/session-service.ts';
import { localTerminalModule } from '../modules/local-terminal/index.ts';
import { sshModule } from '../modules/ssh/index.ts';
import { ConnectionStore } from '../services/connections/store.ts';
import { CredentialStore } from '../services/credentials/store.ts';
import { KnownHostsStore } from '../services/known-hosts/store.ts';
import { LayoutStore } from '../services/layouts/store.ts';
import { TransferQueue } from '../services/transfers/queue.ts';
import { IPC, TRANSFERS_IPC } from '../shared/ipc.ts';
import { registerConnectionOpenIpc } from './connection-open-ipc.ts';
import { registerConnectionsIpc } from './connections-ipc.ts';
import { registerCredentialsIpc } from './credentials-ipc.ts';
import { registerFilesIpc } from './files-ipc.ts';
import { registerSessionIpc } from './ipc.ts';
import { registerKnownHostsIpc } from './known-hosts-ipc.ts';
import { registerLayoutsIpc } from './layouts-ipc.ts';
import { createSafeStorageCodec } from './secret-codec.ts';
import { registerTransfersIpc } from './transfers-ipc.ts';

interface AppServices {
  connections: ConnectionStore;
  credentials: CredentialStore;
  knownHosts: KnownHostsStore;
  layouts: LayoutStore;
}

app.setName('ETerm');

const registry = new ModuleRegistry();
registry.register(localTerminalModule);
registry.register(sshModule);
registry.setupAll();

let disposeIpc: (() => void) | null = null;
let disposeConnectionsIpc: (() => void) | null = null;
let disposeConnectionOpenIpc: (() => void) | null = null;
let disposeFilesIpc: (() => void) | null = null;
let disposeTransfersIpc: (() => void) | null = null;
let transferQueue: TransferQueue | null = null;
let disposeKnownHostsIpc: (() => void) | null = null;
let disposeLayoutsIpc: (() => void) | null = null;
let disposeCredentialsIpc: (() => void) | null = null;
let sessions: SessionService | null = null;
let appServices: AppServices | null = null;

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
  if (appServices) {
    disposeConnectionOpenIpc = registerConnectionOpenIpc(service, appServices);
  }
  disposeFilesIpc = registerFilesIpc(service);
  transferQueue = new TransferQueue({
    getPort: (sessionId) => service.transferPort(sessionId),
    onChange: (task) => {
      if (!window.isDestroyed()) window.webContents.send(TRANSFERS_IPC.update, task);
    },
  });
  disposeTransfersIpc = registerTransfersIpc(transferQueue, service, window);

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    disposeIpc?.();
    disposeIpc = null;
    disposeConnectionOpenIpc?.();
    disposeConnectionOpenIpc = null;
    disposeFilesIpc?.();
    disposeFilesIpc = null;
    disposeTransfersIpc?.();
    disposeTransfersIpc = null;
    transferQueue?.dispose();
    transferQueue = null;
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
  // 冒烟可用 ETERM_USER_DATA 指向临时目录，避免污染真实配置与 known_hosts。
  const baseDir = process.env.ETERM_USER_DATA ?? app.getPath('userData');
  const services: AppServices = {
    connections: new ConnectionStore({ baseDir }),
    credentials: new CredentialStore({ baseDir, codec: createSafeStorageCodec() }),
    knownHosts: new KnownHostsStore({ baseDir }),
    layouts: new LayoutStore({ baseDir }),
  };
  appServices = services;
  registry.provide('connections', services.connections);
  registry.provide('credentials', services.credentials);
  registry.provide('knownHosts', services.knownHosts);
  registry.provide('layouts', services.layouts);

  disposeConnectionsIpc = registerConnectionsIpc(services.connections, services.credentials);
  disposeKnownHostsIpc = registerKnownHostsIpc(services.knownHosts);
  disposeLayoutsIpc = registerLayoutsIpc(services.layouts);
  disposeCredentialsIpc = registerCredentialsIpc(services.credentials);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  disposeConnectionsIpc?.();
  disposeConnectionsIpc = null;
  disposeKnownHostsIpc?.();
  disposeKnownHostsIpc = null;
  disposeLayoutsIpc?.();
  disposeLayoutsIpc = null;
  disposeCredentialsIpc?.();
  disposeCredentialsIpc = null;
  sessions?.dispose();
  registry.dispose();
});
