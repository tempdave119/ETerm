import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CONFIG_IPC,
  CONNECTIONS_IPC,
  CONNECTION_IPC,
  CREDENTIALS_IPC,
  FILES_IPC,
  IPC,
  KNOWN_HOSTS_IPC,
  LAYOUTS_IPC,
  TRANSFERS_IPC,
  type AppConfig,
  type ConnectionInput,
  type ConnectionRecord,
  type ConnectionsSnapshot,
  type EtermApi,
  type FileEntry,
  type FilePreview,
  type GroupInput,
  type GroupRecord,
  type IpcResult,
  type LayoutTemplate,
  type OpenConnectionRequest,
  type OpenedSession,
  type SecretKind,
  type TransferView,
} from '../shared/ipc.ts';
import type { ExitInfo } from '../core/ports.ts';

const api: EtermApi = {
  openSession: (options) => ipcRenderer.invoke(IPC.open, options) as Promise<IpcResult<OpenedSession>>,
  writeSession: (sessionId, data) =>
    ipcRenderer.invoke(IPC.write, sessionId, data) as Promise<IpcResult<null>>,
  resizeSession: (sessionId, cols, rows) =>
    ipcRenderer.invoke(IPC.resize, sessionId, cols, rows) as Promise<IpcResult<null>>,
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.close, sessionId) as Promise<IpcResult<null>>,

  onSessionData: (handler) => {
    const listener = (_event: IpcRendererEvent, sessionId: string, data: string): void => {
      handler(sessionId, data);
    };
    ipcRenderer.on(IPC.data, listener);
    return () => ipcRenderer.removeListener(IPC.data, listener);
  },

  onSessionExit: (handler) => {
    const listener = (_event: IpcRendererEvent, sessionId: string, info: ExitInfo): void => {
      handler(sessionId, info);
    };
    ipcRenderer.on(IPC.exit, listener);
    return () => ipcRenderer.removeListener(IPC.exit, listener);
  },

  listConnections: () =>
    ipcRenderer.invoke(CONNECTIONS_IPC.list) as Promise<IpcResult<ConnectionsSnapshot>>,
  saveConnection: (input: ConnectionInput) =>
    ipcRenderer.invoke(CONNECTIONS_IPC.saveConnection, input) as Promise<IpcResult<ConnectionRecord>>,
  deleteConnection: (id: string) =>
    ipcRenderer.invoke(CONNECTIONS_IPC.deleteConnection, id) as Promise<IpcResult<null>>,
  saveGroup: (input: GroupInput) =>
    ipcRenderer.invoke(CONNECTIONS_IPC.saveGroup, input) as Promise<IpcResult<GroupRecord>>,
  deleteGroup: (id: string) =>
    ipcRenderer.invoke(CONNECTIONS_IPC.deleteGroup, id) as Promise<IpcResult<null>>,

  openConnection: (request: OpenConnectionRequest) =>
    ipcRenderer.invoke(CONNECTION_IPC.open, request) as Promise<IpcResult<OpenedSession>>,
  rememberHostKey: (host: string, port: number, fingerprint: string) =>
    ipcRenderer.invoke(KNOWN_HOSTS_IPC.remember, { host, port, fingerprint }) as Promise<IpcResult<null>>,

  setCredential: (connectionId: string, kind: SecretKind, secret: string) =>
    ipcRenderer.invoke(CREDENTIALS_IPC.set, { connectionId, kind, secret }) as Promise<IpcResult<null>>,
  hasCredential: (connectionId: string, kind: SecretKind) =>
    ipcRenderer.invoke(CREDENTIALS_IPC.has, { connectionId, kind }) as Promise<IpcResult<boolean>>,

  reorderConnections: (orderedIds: string[]) =>
    ipcRenderer.invoke(CONNECTIONS_IPC.reorder, orderedIds) as Promise<IpcResult<null>>,
  listFiles: (sessionId: string, path: string) =>
    ipcRenderer.invoke(FILES_IPC.list, { sessionId, path }) as Promise<IpcResult<FileEntry[]>>,
  readFilePreview: (sessionId: string, path: string) =>
    ipcRenderer.invoke(FILES_IPC.read, { sessionId, path }) as Promise<IpcResult<FilePreview>>,

  listTransfers: () => ipcRenderer.invoke(TRANSFERS_IPC.list) as Promise<IpcResult<TransferView[]>>,
  cancelTransfer: (id: string) =>
    ipcRenderer.invoke(TRANSFERS_IPC.cancel, id) as Promise<IpcResult<null>>,
  retryTransfer: (id: string) =>
    ipcRenderer.invoke(TRANSFERS_IPC.retry, id) as Promise<IpcResult<null>>,
  pickUpload: (sessionId: string, remoteDir: string) =>
    ipcRenderer.invoke(TRANSFERS_IPC.pickUpload, { sessionId, remoteDir }) as Promise<
      IpcResult<TransferView | null>
    >,
  pickDownload: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke(TRANSFERS_IPC.pickDownload, { sessionId, remotePath }) as Promise<
      IpcResult<TransferView | null>
    >,
  onTransferUpdate: (handler: (task: TransferView) => void) => {
    const listener = (_event: IpcRendererEvent, task: TransferView): void => handler(task);
    ipcRenderer.on(TRANSFERS_IPC.update, listener);
    return () => ipcRenderer.removeListener(TRANSFERS_IPC.update, listener);
  },

  getLayout: (key: string) =>
    ipcRenderer.invoke(LAYOUTS_IPC.get, key) as Promise<IpcResult<LayoutTemplate | null>>,
  saveLayout: (key: string, template: LayoutTemplate) =>
    ipcRenderer.invoke(LAYOUTS_IPC.save, { key, template }) as Promise<IpcResult<null>>,

  getConfig: () => ipcRenderer.invoke(CONFIG_IPC.get) as Promise<IpcResult<AppConfig>>,
  saveConfig: (config: AppConfig) =>
    ipcRenderer.invoke(CONFIG_IPC.save, config) as Promise<IpcResult<AppConfig>>,
  resetConfig: () => ipcRenderer.invoke(CONFIG_IPC.reset) as Promise<IpcResult<AppConfig>>,
  onConfigChange: (handler: (config: AppConfig) => void) => {
    const listener = (_event: IpcRendererEvent, config: AppConfig): void => handler(config);
    ipcRenderer.on(CONFIG_IPC.changed, listener);
    return () => ipcRenderer.removeListener(CONFIG_IPC.changed, listener);
  },
};

contextBridge.exposeInMainWorld('eterm', api);
