import type { ProductErrorInfo } from '../core/errors.ts';
import type { Capability, ExitInfo, FileEntry, SessionOpenOptions } from '../core/ports.ts';
import type { SecretKind } from '../services/credentials/store.ts';
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
export type { FileEntry };

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

export interface FilePreview {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
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
}
