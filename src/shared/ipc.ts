import type { ProductErrorInfo } from '../core/errors.ts';
import type { Capability, ExitInfo, SessionOpenOptions } from '../core/ports.ts';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionsSnapshot,
  GroupInput,
  GroupRecord,
} from '../services/connections/types.ts';

export type { ProductErrorInfo };
export type { ConnectionInput, ConnectionRecord, ConnectionsSnapshot, GroupInput, GroupRecord };

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
} as const;

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
}
