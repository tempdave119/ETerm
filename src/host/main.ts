import { app, BrowserWindow, nativeTheme } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ModuleRegistry } from '../core/registry.ts';
import type { CapabilityModule } from '../core/manifest.ts';
import { SessionService } from '../core/session-service.ts';
import { localTerminalModule } from '../modules/local-terminal/index.ts';
import { sshModule } from '../modules/ssh/index.ts';
import { ConnectionStore } from '../services/connections/store.ts';
import { ConfigStore } from '../services/config/store.ts';
import { CredentialStore } from '../services/credentials/store.ts';
import { KnownHostsStore } from '../services/known-hosts/store.ts';
import { LayoutStore } from '../services/layouts/store.ts';
import { TransferQueue } from '../services/transfers/queue.ts';
import { IPC, TRANSFERS_IPC } from '../shared/ipc.ts';
import type { ComponentDescriptor } from '../shared/components.ts';
import { registerClipboardIpc } from './clipboard-ipc.ts';
import { registerComponentsIpc } from './components-ipc.ts';
import { loadComponents } from './components.ts';
import { registerConnectionOpenIpc } from './connection-open-ipc.ts';
import { registerConfigIpc } from './config-ipc.ts';
import { registerConnectionsIpc } from './connections-ipc.ts';
import { registerCredentialsIpc } from './credentials-ipc.ts';
import { registerFilesIpc } from './files-ipc.ts';
import { registerForwardsIpc } from './forwards-ipc.ts';
import { registerSessionIpc } from './ipc.ts';
import { registerKnownHostsIpc } from './known-hosts-ipc.ts';
import { registerLayoutsIpc } from './layouts-ipc.ts';
import { createSafeStorageCodec } from './secret-codec.ts';
import { registerSystemIpc } from './system-ipc.ts';
import { registerTransfersIpc } from './transfers-ipc.ts';

interface AppServices {
  connections: ConnectionStore;
  config: ConfigStore;
  credentials: CredentialStore;
  knownHosts: KnownHostsStore;
  layouts: LayoutStore;
}

app.setName('ETerm');

const registry = new ModuleRegistry();
registry.register(localTerminalModule);

// M4 验证入口：仅开发环境可通过环境变量换掉 SSH 实现，打包产物始终用内置模块。
const altSshPath = process.env.ETERM_SSH_ALT_PATH;
if (!app.isPackaged && altSshPath) {
  const alt = require(altSshPath) as { sshAltModule: CapabilityModule };
  registry.register(alt.sshAltModule);
} else {
  registry.register(sshModule);
}

let disposeIpc: (() => void) | null = null;
let disposeConnectionsIpc: (() => void) | null = null;
let disposeConfigIpc: (() => void) | null = null;
let disposeConnectionOpenIpc: (() => void) | null = null;
let disposeFilesIpc: (() => void) | null = null;
let disposeForwardsIpc: (() => void) | null = null;
let disposeTransfersIpc: (() => void) | null = null;
let transferQueue: TransferQueue | null = null;
let disposeKnownHostsIpc: (() => void) | null = null;
let disposeComponentsIpc: (() => void) | null = null;
let componentDescriptors: ComponentDescriptor[] = [];
let disposeLayoutsIpc: (() => void) | null = null;
let disposeSystemIpc: (() => void) | null = null;
let disposeClipboardIpc: (() => void) | null = null;
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#f5f6f8',
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
  disposeForwardsIpc = registerForwardsIpc(service);
  disposeSystemIpc = registerSystemIpc(service);
  disposeClipboardIpc = registerClipboardIpc();
  transferQueue = new TransferQueue({
    getPort: (sessionId) => service.transferPort(sessionId),
    onChange: (task) => {
      if (!window.isDestroyed()) window.webContents.send(TRANSFERS_IPC.update, task);
    },
  });
  disposeTransfersIpc = registerTransfersIpc(transferQueue, service, window);
  if (appServices) {
    const settings = appServices.config;
    disposeConfigIpc = registerConfigIpc(settings, window, (config) => {
      transferQueue?.setMaxConcurrent(config.transfer.concurrency);
    });
    void settings.get().then((config) => transferQueue?.setMaxConcurrent(config.transfer.concurrency));
  }

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    disposeIpc?.();
    disposeIpc = null;
    disposeConnectionOpenIpc?.();
    disposeConnectionOpenIpc = null;
    disposeFilesIpc?.();
    disposeFilesIpc = null;
    disposeForwardsIpc?.();
    disposeForwardsIpc = null;
    disposeSystemIpc?.();
    disposeSystemIpc = null;
    disposeClipboardIpc?.();
    disposeClipboardIpc = null;
    disposeTransfersIpc?.();
    disposeTransfersIpc = null;
    disposeConfigIpc?.();
    disposeConfigIpc = null;
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

void app.whenReady().then(async () => {
  // 开发模式没有 bundle 图标，Dock 会显示 Electron 默认图标；换成 assets 下的正式图标。
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    if (existsSync(iconPath)) app.dock?.setIcon(iconPath);
  }
  // 冒烟可用 ETERM_USER_DATA 指向临时目录，避免污染真实配置与 known_hosts。
  const baseDir = process.env.ETERM_USER_DATA ?? app.getPath('userData');
  const services: AppServices = {
    connections: new ConnectionStore({ baseDir }),
    config: new ConfigStore({ baseDir }),
    credentials: new CredentialStore({ baseDir, codec: createSafeStorageCodec() }),
    knownHosts: new KnownHostsStore({ baseDir }),
    layouts: new LayoutStore({ baseDir }),
  };
  appServices = services;
  registry.provide('connections', services.connections);
  registry.provide('credentials', services.credentials);
  registry.provide('knownHosts', services.knownHosts);
  registry.provide('layouts', services.layouts);

  // 服务注入后再装载组件并 setup，组件就能通过 ctx.get() 取宿主服务。
  componentDescriptors = await loadComponents({
    baseDir,
    registry,
    logger: (message, detail) => console.warn(`[components] ${message}`, detail ?? ''),
  });
  registry.setupAll();
  disposeComponentsIpc = registerComponentsIpc(() => componentDescriptors);

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
  disposeComponentsIpc?.();
  disposeComponentsIpc = null;
  disposeConfigIpc?.();
  disposeConfigIpc = null;
  disposeKnownHostsIpc?.();
  disposeKnownHostsIpc = null;
  disposeLayoutsIpc?.();
  disposeLayoutsIpc = null;
  disposeForwardsIpc?.();
  disposeForwardsIpc = null;
  disposeSystemIpc?.();
  disposeSystemIpc = null;
  disposeCredentialsIpc?.();
  disposeCredentialsIpc = null;
  sessions?.dispose();
  registry.dispose();
});
