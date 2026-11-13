import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import {
  CLIPBOARD_IPC,
  COMPONENTS_IPC,
  CONFIG_IPC,
  CONNECTIONS_IPC,
  CONNECTION_IPC,
  CREDENTIALS_IPC,
  DROP_IPC,
  FILES_IPC,
  FORWARDS_IPC,
  IPC,
  KNOWN_HOSTS_IPC,
  LAYOUTS_IPC,
  SYSTEM_IPC,
  TRANSFERS_IPC,
  type AppConfig,
  type ComponentDescriptor,
  type ConnectionInput,
  type ConnectionRecord,
  type ConnectionsSnapshot,
  type EtermApi,
  type FileEntry,
  type FilePreview,
  type ForwardRequest,
  type ForwardView,
  type GroupInput,
  type GroupRecord,
  type IpcResult,
  type LayoutTemplate,
  type OpenConnectionRequest,
  type OpenedSession,
  type PanelLayout,
  type SecretKind,
  type SystemStats,
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
      IpcResult<TransferView[] | null>
    >,
  pickDownload: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke(TRANSFERS_IPC.pickDownload, { sessionId, remotePath }) as Promise<
      IpcResult<TransferView | null>
    >,
  registerDroppedFiles: (files: File[]) => {
    const paths: string[] = [];
    for (const file of files) {
      try {
        const path = webUtils.getPathForFile(file);
        if (path) paths.push(path);
      } catch {
        // 合成 File 没有本地路径；跳过即可，由主进程返回空列表错误。
      }
    }
    return ipcRenderer.invoke(DROP_IPC.register, paths) as Promise<IpcResult<string[]>>;
  },
  uploadDropped: (sessionId: string, remoteDir: string, tokens: string[]) =>
    ipcRenderer.invoke(TRANSFERS_IPC.uploadDropped, { sessionId, remoteDir, tokens }) as Promise<
      IpcResult<TransferView[]>
    >,
  onTransferUpdate: (handler: (task: TransferView) => void) => {
    const listener = (_event: IpcRendererEvent, task: TransferView): void => handler(task);
    ipcRenderer.on(TRANSFERS_IPC.update, listener);
    return () => ipcRenderer.removeListener(TRANSFERS_IPC.update, listener);
  },

  listForwards: (sessionId: string) =>
    ipcRenderer.invoke(FORWARDS_IPC.list, sessionId) as Promise<IpcResult<ForwardView[]>>,
  openForward: (sessionId: string, request: ForwardRequest) =>
    ipcRenderer.invoke(FORWARDS_IPC.open, { sessionId, request }) as Promise<IpcResult<ForwardView>>,
  closeForward: (sessionId: string, id: string) =>
    ipcRenderer.invoke(FORWARDS_IPC.close, { sessionId, id }) as Promise<IpcResult<null>>,

  getLayout: (key: string) =>
    ipcRenderer.invoke(LAYOUTS_IPC.get, key) as Promise<IpcResult<LayoutTemplate | null>>,
  saveLayout: (key: string, template: LayoutTemplate) =>
    ipcRenderer.invoke(LAYOUTS_IPC.save, { key, template }) as Promise<IpcResult<null>>,
  getPanelLayout: () => ipcRenderer.invoke(LAYOUTS_IPC.panelsGet) as Promise<IpcResult<PanelLayout>>,
  savePanelLayout: (state: PanelLayout) =>
    ipcRenderer.invoke(LAYOUTS_IPC.panelsSave, state) as Promise<IpcResult<null>>,

  getSystemStats: () => ipcRenderer.invoke(SYSTEM_IPC.stats) as Promise<IpcResult<SystemStats>>,

  readClipboard: () => ipcRenderer.invoke(CLIPBOARD_IPC.read) as Promise<IpcResult<string>>,
  writeClipboard: (text: string) =>
    ipcRenderer.invoke(CLIPBOARD_IPC.write, text) as Promise<IpcResult<null>>,

  getConfig: () => ipcRenderer.invoke(CONFIG_IPC.get) as Promise<IpcResult<AppConfig>>,
  saveConfig: (config: AppConfig) =>
    ipcRenderer.invoke(CONFIG_IPC.save, config) as Promise<IpcResult<AppConfig>>,
  resetConfig: () => ipcRenderer.invoke(CONFIG_IPC.reset) as Promise<IpcResult<AppConfig>>,
  onConfigChange: (handler: (config: AppConfig) => void) => {
    const listener = (_event: IpcRendererEvent, config: AppConfig): void => handler(config);
    ipcRenderer.on(CONFIG_IPC.changed, listener);
    return () => ipcRenderer.removeListener(CONFIG_IPC.changed, listener);
  },

  listComponents: () => ipcRenderer.invoke(COMPONENTS_IPC.list) as Promise<IpcResult<ComponentDescriptor[]>>,
};

contextBridge.exposeInMainWorld('eterm', api);
