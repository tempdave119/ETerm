import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CONNECTIONS_IPC,
  IPC,
  type ConnectionInput,
  type ConnectionRecord,
  type ConnectionsSnapshot,
  type EtermApi,
  type GroupInput,
  type GroupRecord,
  type IpcResult,
  type OpenedSession,
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
};

contextBridge.exposeInMainWorld('eterm', api);
