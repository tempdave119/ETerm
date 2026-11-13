import type { ProductErrorInfo } from '../core/errors.ts';
import type { Capability, ExitInfo, FileEntry, SessionOpenOptions } from '../core/ports.ts';
import type { SecretKind } from '../services/credentials/store.ts';
import type { AppConfig, ThemePreference, UiDensity } from '../services/config/schema.ts';
import type { TransferDirection, TransferView } from '../services/transfers/queue.ts';
import type { LayoutTemplate } from './layout-template.ts';
import type { PanelState } from './panels.ts';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionsSnapshot,
  GroupInput,
  GroupRecord,
} from '../services/connections/types.ts';

export type { ProductErrorInfo };
export type { Capability };
export type { ConnectionInput, ConnectionRecord, ConnectionsSnapshot, GroupInput, GroupRecord };
export type { SecretKind };
export type { AppConfig, ThemePreference, UiDensity };
export type { FileEntry };
export type { TransferDirection, TransferView };
export type { LayoutTemplate };
export type { PanelState };

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
} as const;

export const TRANSFERS_IPC = {
  list: 'transfers:list',
  cancel: 'transfers:cancel',
  retry: 'transfers:retry',
  pickUpload: 'transfers:pick-upload',
  pickDownload: 'transfers:pick-download',
  update: 'transfers:update',
} as const;

export const LAYOUTS_IPC = {
  get: 'layouts:get',
  save: 'layouts:save',
  panelsGet: 'layouts:panels-get',
  panelsSave: 'layouts:panels-save',
} as const;

export const SYSTEM_IPC = {
  stats: 'system:stats',
} as const;

export const CONFIG_IPC = {
  get: 'config:get',
  save: 'config:save',
  reset: 'config:reset',
  changed: 'config:changed',
} as const;

export interface FilePreview {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface SystemStats {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  load: [number, number, number];
  uptime: number;
  cpus: number;
}

export const CONNECTION_IPC = {
  open: 'connection:open',
} as const;

export const KNOWN_HOSTS_IPC = {
  remember: 'known_hosts:remember',
} as const;

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

  listTransfers(): Promise<IpcResult<TransferView[]>>;
  cancelTransfer(id: string): Promise<IpcResult<null>>;
  retryTransfer(id: string): Promise<IpcResult<null>>;
  pickUpload(sessionId: string, remoteDir: string): Promise<IpcResult<TransferView | null>>;
  pickDownload(sessionId: string, remotePath: string): Promise<IpcResult<TransferView | null>>;
  onTransferUpdate(handler: (task: TransferView) => void): () => void;

  getLayout(key: string): Promise<IpcResult<LayoutTemplate | null>>;
  saveLayout(key: string, template: LayoutTemplate): Promise<IpcResult<null>>;
  getPanelState(): Promise<IpcResult<PanelState>>;
  savePanelState(state: PanelState): Promise<IpcResult<null>>;

  getSystemStats(): Promise<IpcResult<SystemStats>>;

  getConfig(): Promise<IpcResult<AppConfig>>;
  saveConfig(config: AppConfig): Promise<IpcResult<AppConfig>>;
  resetConfig(): Promise<IpcResult<AppConfig>>;
  onConfigChange(handler: (config: AppConfig) => void): () => void;
}
