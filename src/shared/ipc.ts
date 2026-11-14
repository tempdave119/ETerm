import type { ProductErrorInfo } from '../core/errors.ts';
import type { Capability, ExitInfo, FileEntry, ForwardDirection, ForwardRequest, ForwardView, SessionOpenOptions } from '../core/ports.ts';
import type { CommandId } from './commands.ts';
import type { SecretKind } from '../services/credentials/store.ts';
import type {
  AppConfig,
  LanguagePreference,
  RightClickAction,
  ThemePreference,
  UiDensity,
} from '../services/config/schema.ts';
import type { TransferDirection, TransferView } from '../services/transfers/queue.ts';
import type { LayoutTemplate } from './layout-template.ts';
import type { PanelLayout } from './panels.ts';
import type { ComponentDescriptor, ComponentSample } from './components.ts';
import type { PluginRecord } from './plugins.ts';
import type { ThemeDefinition } from './theme.ts';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionsSnapshot,
  GroupInput,
  GroupRecord,
} from '../services/connections/types.ts';

export type { ProductErrorInfo };
export type { Capability };
export type { ForwardDirection, ForwardRequest, ForwardView };
export type { ConnectionInput, ConnectionRecord, ConnectionsSnapshot, GroupInput, GroupRecord };
export type { SecretKind };
export type { AppConfig, RightClickAction, ThemePreference, UiDensity, LanguagePreference };
// 渲染层的「恢复默认设置」要拿默认值做草稿，schema 是纯数据模块，可安全共用。
export { defaultConfig } from '../services/config/schema.ts';
export type { FileEntry };
export type { TransferDirection, TransferView };
export type { LayoutTemplate };
export type { PanelLayout };
export type { ComponentField, ComponentSample, ComponentDescriptor } from './components.ts';
export type { ThemeDefinition };

export const IPC = {
  open: 'session:open',
  write: 'session:write',
  resize: 'session:resize',
  close: 'session:close',
  data: 'session:data',
  exit: 'session:exit',
} as const;

export const CONNECTIONS_IPC = {
  list: 'connections:list',
  saveConnection: 'connections:save',
  deleteConnection: 'connections:delete',
  saveGroup: 'groups:save',
  deleteGroup: 'groups:delete',
  reorder: 'connections:reorder',
} as const;

export const FILES_IPC = {
  list: 'files:list',
  read: 'files:read',
  mkdir: 'files:mkdir',
  rename: 'files:rename',
  remove: 'files:remove',
} as const;

export const PLUGINS_IPC = {
  list: 'plugins:list',
  install: 'plugins:install',
  setEnabled: 'plugins:set-enabled',
  uninstall: 'plugins:uninstall',
  openDir: 'plugins:open-dir',
} as const;

export const TRANSFERS_IPC = {
  list: 'transfers:list',
  cancel: 'transfers:cancel',
  retry: 'transfers:retry',
  pause: 'transfers:pause',
  resume: 'transfers:resume',
  pickUpload: 'transfers:pick-upload',
  pickDownload: 'transfers:pick-download',
  pickDownloadDir: 'transfers:pick-download-dir',
  uploadDropped: 'transfers:upload-dropped',
  update: 'transfers:update',
} as const;

export const DROP_IPC = {
  register: 'drop:register',
} as const;

export const THEMES_IPC = {
  list: 'themes:list',
  openDir: 'themes:open-dir',
} as const;

export const FORWARDS_IPC = {
  list: 'forwards:list',
  open: 'forwards:open',
  close: 'forwards:close',
} as const;

export const LAYOUTS_IPC = {
  get: 'layouts:get',
  save: 'layouts:save',
  panelsGet: 'layouts:panels-get',
  panelsSave: 'layouts:panels-save',
} as const;

export const SYSTEM_IPC = {
  stats: 'system:stats',
  remoteStats: 'system:remote-stats',
} as const;

export const CLIPBOARD_IPC = {
  read: 'clipboard:read',
  write: 'clipboard:write',
} as const;

export const CONFIG_IPC = {
  get: 'config:get',
  save: 'config:save',
  reset: 'config:reset',
  changed: 'config:changed',
} as const;

export const MENU_IPC = {
  command: 'menu:command',
} as const;

/** 应用菜单只能发起这些动作：命令注册表里的命令 + 终端编辑动作。 */
export type MenuCommand = CommandId | 'edit.copy' | 'edit.paste' | 'edit.selectAll';

export interface FilePreview {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface FileSystemUsage {
  path: string;
  used: number;
  total: number;
}

export interface ProcessUsage {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
  /** 常驻内存，字节。 */
  rss: number;
}

export interface SystemStats {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  load: [number, number, number];
  uptime: number;
  cpus: number;
  /** 本机取根分区；远端取 df 的主要挂载点。 */
  filesystems?: FileSystemUsage[];
  /** 系统主机名；连接名由渲染层另外提供。 */
  hostname?: string;
  /** 按常驻内存排序的前 5 个进程。 */
  processes?: ProcessUsage[];
  /** 按 CPU 占用排序的前 5 个进程。 */
  processesByCpu?: ProcessUsage[];
}

export const CONNECTION_IPC = {
  open: 'connection:open',
} as const;

export const KNOWN_HOSTS_IPC = {
  remember: 'known_hosts:remember',
} as const;

export const COMPONENTS_IPC = {
  list: 'components:list',
  samples: 'components:samples',
  installSamples: 'components:install-samples',
  uninstallSample: 'components:uninstall-sample',
  openDir: 'components:open-dir',
} as const;

export const SERIAL_IPC = {
  list: 'serial:list',
} as const;

/** 串口设备：path 为 /dev/cu.*，label 是去掉前缀后的短名。 */
export interface SerialDevice {
  path: string;
  label: string;
}

export const CREDENTIALS_IPC = {
  set: 'credentials:set',
  has: 'credentials:has',
} as const;

export interface OpenConnectionRequest {
  connectionId: string;
  cols: number;
  rows: number;
}

export interface OpenedSession {
  sessionId: string;
  capabilities: Capability[];
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: ProductErrorInfo };

export interface EtermApi {
  openSession(options: SessionOpenOptions): Promise<IpcResult<OpenedSession>>;
  writeSession(sessionId: string, data: string): Promise<IpcResult<null>>;
  resizeSession(sessionId: string, cols: number, rows: number): Promise<IpcResult<null>>;
  closeSession(sessionId: string): Promise<IpcResult<null>>;
  onSessionData(handler: (sessionId: string, data: string) => void): () => void;
  onSessionExit(handler: (sessionId: string, info: ExitInfo) => void): () => void;

  listConnections(): Promise<IpcResult<ConnectionsSnapshot>>;
  saveConnection(input: ConnectionInput): Promise<IpcResult<ConnectionRecord>>;
  deleteConnection(id: string): Promise<IpcResult<null>>;
  saveGroup(input: GroupInput): Promise<IpcResult<GroupRecord>>;
  deleteGroup(id: string): Promise<IpcResult<null>>;

  openConnection(request: OpenConnectionRequest): Promise<IpcResult<OpenedSession>>;
  rememberHostKey(host: string, port: number, fingerprint: string): Promise<IpcResult<null>>;

  setCredential(connectionId: string, kind: SecretKind, secret: string): Promise<IpcResult<null>>;
  hasCredential(connectionId: string, kind: SecretKind): Promise<IpcResult<boolean>>;

  reorderConnections(orderedIds: string[]): Promise<IpcResult<null>>;
  listFiles(sessionId: string, path: string): Promise<IpcResult<FileEntry[]>>;
  readFilePreview(sessionId: string, path: string): Promise<IpcResult<FilePreview>>;
  createDirectory(sessionId: string, path: string): Promise<IpcResult<null>>;
  renameEntry(sessionId: string, path: string, nextPath: string): Promise<IpcResult<null>>;
  deleteFile(sessionId: string, path: string): Promise<IpcResult<null>>;

  listPlugins(): Promise<IpcResult<PluginRecord[]>>;
  /** 弹目录选择框；取消时返回 null。 */
  installPlugin(): Promise<IpcResult<PluginRecord | null>>;
  setPluginEnabled(id: string, enabled: boolean): Promise<IpcResult<null>>;
  uninstallPlugin(id: string): Promise<IpcResult<null>>;
  openPluginsDir(): Promise<IpcResult<null>>;

  listTransfers(): Promise<IpcResult<TransferView[]>>;
  cancelTransfer(id: string): Promise<IpcResult<null>>;
  retryTransfer(id: string): Promise<IpcResult<null>>;
  pauseTransfer(id: string): Promise<IpcResult<null>>;
  resumeTransfer(id: string): Promise<IpcResult<null>>;
  pickUpload(sessionId: string, remoteDir: string): Promise<IpcResult<TransferView[] | null>>;
  pickDownload(sessionId: string, remotePath: string): Promise<IpcResult<TransferView | null>>;
  pickDownloadDir(sessionId: string, remotePath: string): Promise<IpcResult<TransferView[] | null>>;
  registerDroppedFiles(files: File[]): Promise<IpcResult<string[]>>;
  uploadDropped(
    sessionId: string,
    remoteDir: string,
    tokens: string[],
  ): Promise<IpcResult<TransferView[]>>;
  onTransferUpdate(handler: (task: TransferView) => void): () => void;

  listForwards(sessionId: string): Promise<IpcResult<ForwardView[]>>;
  openForward(sessionId: string, request: ForwardRequest): Promise<IpcResult<ForwardView>>;
  closeForward(sessionId: string, id: string): Promise<IpcResult<null>>;

  getLayout(key: string): Promise<IpcResult<LayoutTemplate | null>>;
  saveLayout(key: string, template: LayoutTemplate): Promise<IpcResult<null>>;
  getPanelLayout(): Promise<IpcResult<PanelLayout>>;
  savePanelLayout(state: PanelLayout): Promise<IpcResult<null>>;

  getSystemStats(): Promise<IpcResult<SystemStats>>;
  getRemoteStats(sessionId: string): Promise<IpcResult<SystemStats>>;

  readClipboard(): Promise<IpcResult<string>>;
  writeClipboard(text: string): Promise<IpcResult<null>>;

  getConfig(): Promise<IpcResult<AppConfig>>;
  listThemes(): Promise<IpcResult<ThemeDefinition[]>>;
  openThemesDir(): Promise<IpcResult<null>>;
  saveConfig(config: AppConfig): Promise<IpcResult<AppConfig>>;
  resetConfig(): Promise<IpcResult<AppConfig>>;
  onConfigChange(handler: (config: AppConfig) => void): () => void;

  onMenuCommand(handler: (command: MenuCommand) => void): () => void;

  listComponents(): Promise<IpcResult<ComponentDescriptor[]>>;
  listComponentSamples(): Promise<IpcResult<ComponentSample[]>>;
  installComponentSamples(ids?: string[]): Promise<IpcResult<{ installed: string[]; skipped: string[] }>>;
  uninstallComponentSample(id: string): Promise<IpcResult<{ removed: string[]; skipped: string[] }>>;
  openComponentsDir(): Promise<IpcResult<null>>;
  listSerialDevices(): Promise<IpcResult<SerialDevice[]>>;
}
