import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type Tray } from 'electron';
import Module from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ModuleRegistry } from '../core/registry.ts';
import type { CapabilityModule } from '../core/manifest.ts';
import { SessionService } from '../core/session-service.ts';
import { localTerminalModule } from '../modules/local-terminal/index.ts';
import { sshModule } from '../modules/ssh/index.ts';
import { ConnectionStore } from '../services/connections/store.ts';
import { ConfigStore } from '../services/config/store.ts';
import type { AppConfig } from '../services/config/schema.ts';
import { CredentialStore } from '../services/credentials/store.ts';
import { KnownHostsStore } from '../services/known-hosts/store.ts';
import { LayoutStore } from '../services/layouts/store.ts';
import { ThemeStore } from '../services/themes/store.ts';
import { TransferQueue } from '../services/transfers/queue.ts';
import { WindowStateStore } from '../services/window-state/store.ts';
import { IPC, MENU_IPC, TRANSFERS_IPC } from '../shared/ipc.ts';
import type { MenuCommand } from '../shared/ipc.ts';
import { normalizeLocale, setLocale } from '../shared/i18n/index.ts';
import { resolveShortcuts } from '../shared/shortcut.ts';
import {
  MIN_WINDOW_SIZE,
  defaultWindowBounds,
  fitWindowBounds,
  type WindowRect,
} from '../shared/window-bounds.ts';
import type { ComponentDescriptor } from '../shared/components.ts';
import { registerClipboardIpc } from './clipboard-ipc.ts';
import { registerComponentsIpc } from './components-ipc.ts';
import { registerPluginsIpc } from './plugins-ipc.ts';
import { registerPluginProtocol, registerPluginScheme } from './plugin-protocol.ts';
import { PluginStore } from '../services/plugins/store.ts';
import { loadComponents } from './components.ts';
import { registerConnectionOpenIpc } from './connection-open-ipc.ts';
import { registerConfigIpc } from './config-ipc.ts';
import { registerSerialIpc } from './serial-ipc.ts';
import { registerConnectionsIpc } from './connections-ipc.ts';
import { registerCredentialsIpc } from './credentials-ipc.ts';
import { registerFilesIpc } from './files-ipc.ts';
import { registerForwardsIpc } from './forwards-ipc.ts';
import { registerSessionIpc } from './ipc.ts';
import { registerKnownHostsIpc } from './known-hosts-ipc.ts';
import { registerLayoutsIpc } from './layouts-ipc.ts';
import { createSafeStorageCodec } from './secret-codec.ts';
import { registerSystemIpc } from './system-ipc.ts';
import { registerThemesIpc } from './themes-ipc.ts';
import { registerTransfersIpc } from './transfers-ipc.ts';
import { buildMenuTemplate } from './menu.ts';
import { buildTrayMenu, createAppTray, type TrayActions } from './tray.ts';

interface AppServices {
  connections: ConnectionStore;
  config: ConfigStore;
  credentials: CredentialStore;
  knownHosts: KnownHostsStore;
  layouts: LayoutStore;
  themes: ThemeStore;
  windowState: WindowStateStore;
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

// 自定义协议特权必须在 app ready 之前注册；模块加载时立即执行一次。
registerPluginScheme();

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
let disposePluginsIpc: (() => void) | null = null;
let disposePluginProtocol: (() => void) | null = null;
let componentDescriptors: ComponentDescriptor[] = [];
let disposeLayoutsIpc: (() => void) | null = null;
let disposeSystemIpc: (() => void) | null = null;
let disposeThemesIpc: (() => void) | null = null;
let disposeSerialIpc: (() => void) | null = null;
let disposeClipboardIpc: (() => void) | null = null;
let disposeCredentialsIpc: (() => void) | null = null;
let sessions: SessionService | null = null;
let appServices: AppServices | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let menuLogged = false;

/** 菜单项点击统一下发给渲染层；命令分发与快捷键共用一套实现。 */
function sendMenuCommand(command: MenuCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(MENU_IPC.command, command);
}

/** 把窗口恢复到默认尺寸，并居中到当前鼠标所在屏幕。 */
function resetWindowSize(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = defaultWindowBounds(workArea);
  if (window.isFullScreen()) window.setFullScreen(false);
  if (window.isMaximized()) window.unmaximize();
  window.setBounds(bounds);
  void appServices?.windowState.save({ bounds, maximized: false });
}

/** 托盘菜单与主菜单共用同一个命令入口。 */
function trayActions(): TrayActions {
  return {
    showWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return;
      }
      void createWindow();
    },
    run: sendMenuCommand,
  };
}

/** 重建应用菜单：accelerator 跟随用户改键，文案跟随界面语言，改完即时同步。 */
function applyMenu(config: AppConfig): void {
  // 主进程的 i18n 与渲染层独立，这里同步一次语言再生成菜单文案。
  setLocale(normalizeLocale(config.ui.language, app.getLocale()));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(resolveShortcuts(config.shortcuts.overrides), {
        run: sendMenuCommand,
        // 配置、凭据密文与 known_hosts 都在用户数据目录，帮助菜单直接带过去方便排查。
        openDataDir: () => {
          const baseDir = process.env.ETERM_USER_DATA ?? app.getPath('userData');
          void shell.openPath(baseDir);
        },
        showAbout: () => app.showAboutPanel(),
        resetWindowSize,
      }),
    ),
  );
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(trayActions())));
  // 冒烟证据：证明原生菜单在真实 Electron 里装配成功（后续重建不重复打）。
  if (!menuLogged && process.env.ETERM_SMOKE === '1') {
    menuLogged = true;
    const labels = Menu.getApplicationMenu()?.items.map((item) => item.label).join(' / ') ?? '空';
    console.log(`[menu] 已装配：${labels}`);
  }
}

async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  let bounds: WindowRect = defaultWindowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
  let maximized = false;
  if (appServices) {
    try {
      const state = await appServices.windowState.load();
      const displays = screen.getAllDisplays().map((display) => display.workArea);
      const fallback = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      bounds = fitWindowBounds(state.bounds, displays, fallback);
      maximized = state.maximized;
    } catch (error) {
      console.warn('[window] 读取窗口状态失败，使用默认尺寸', error);
    }
  }

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
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
  mainWindow = window;
  if (maximized) window.maximize();

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveWindowState = (): void => {
    if (!appServices || window.isDestroyed()) return;
    void appServices.windowState.save({
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  };
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveWindowState();
    }, 300);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveWindowState();
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
  disposeSerialIpc = registerSerialIpc();
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
      // 改键后菜单提示同步；不动已打开的面板。
      applyMenu(config);
    });
    void settings.get().then((config) => transferQueue?.setMaxConcurrent(config.transfer.concurrency));
  }

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
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
    disposeSerialIpc?.();
    disposeSerialIpc = null;
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
  const pluginStore = new PluginStore({
    baseDir,
    logger: (message, detail) => console.warn(`[plugins] ${message}`, detail ?? ''),
  });
  const services: AppServices = {
    connections: new ConnectionStore({ baseDir }),
    config: new ConfigStore({ baseDir }),
    credentials: new CredentialStore({ baseDir, codec: createSafeStorageCodec() }),
    knownHosts: new KnownHostsStore({ baseDir }),
    layouts: new LayoutStore({ baseDir }),
    themes: new ThemeStore({ baseDir, pluginThemeDirs: () => pluginStore.themeDirs() }),
    windowState: new WindowStateStore({ baseDir }),
  };
  appServices = services;
  registry.provide('connections', services.connections);
  registry.provide('credentials', services.credentials);
  registry.provide('knownHosts', services.knownHosts);
  registry.provide('layouts', services.layouts);

  // 外挂组件位于 userData，组件内部的 require 不在应用目录下；
  // 把 app 的 node_modules 加进全局搜索路径，serialport 这类依赖才能解析。
  const appModules = path.join(app.getAppPath(), 'node_modules');
  process.env.NODE_PATH = [appModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  (Module as unknown as { _initPaths(): void })._initPaths();

  // 服务注入后再装载组件并 setup，组件就能通过 ctx.get() 取宿主服务。
  componentDescriptors = await loadComponents({
    baseDir,
    registry,
    logger: (message, detail) => console.warn(`[components] ${message}`, detail ?? ''),
  });
  registry.setupAll();
  // 示例组件随包放在 Resources/components；开发模式直接读仓库 examples/components。
  const bundledComponentsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'components')
    : path.join(__dirname, '..', '..', 'examples', 'components');
  disposeComponentsIpc = registerComponentsIpc({
    getDescriptors: () => componentDescriptors,
    sampleDirs: { bundledDir: bundledComponentsDir, userDir: path.join(baseDir, 'components') },
  });

  disposePluginsIpc = registerPluginsIpc({
    store: pluginStore,
    pluginsDir: path.join(baseDir, 'plugins'),
  });
  disposePluginProtocol = registerPluginProtocol(pluginStore);

  disposeConnectionsIpc = registerConnectionsIpc(services.connections, services.credentials);
  disposeKnownHostsIpc = registerKnownHostsIpc(services.knownHosts);
  disposeLayoutsIpc = registerLayoutsIpc(services.layouts);
  disposeCredentialsIpc = registerCredentialsIpc(services.credentials);
  disposeThemesIpc = registerThemesIpc(services.themes);

  // 菜单与托盘先于窗口就位：关窗后从托盘唤回窗口时不需要重启应用。
  app.setAboutPanelOptions({
    applicationName: 'ETerm',
    applicationVersion: app.getVersion(),
    copyright: 'Kevin',
  });
  applyMenu(await services.config.get());
  tray = createAppTray(trayActions());
  if (process.env.ETERM_SMOKE === '1') {
    console.log(`[tray] ${tray ? '已创建（模板图）' : '未创建（缺图标或图片为空）'}`);
  }

  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  tray?.destroy();
  tray = null;
  disposeConnectionsIpc?.();
  disposeConnectionsIpc = null;
  disposeComponentsIpc?.();
  disposeComponentsIpc = null;
  disposePluginsIpc?.();
  disposePluginsIpc = null;
  disposePluginProtocol?.();
  disposePluginProtocol = null;
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
  disposeSerialIpc?.();
  disposeSerialIpc = null;
  disposeCredentialsIpc?.();
  disposeCredentialsIpc = null;
  disposeThemesIpc?.();
  disposeThemesIpc = null;
  sessions?.dispose();
  registry.dispose();
});
