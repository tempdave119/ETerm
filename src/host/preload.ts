import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type EtermApi, type IpcResult, type OpenedSession } from '../shared/ipc.ts';
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
};

contextBridge.exposeInMainWorld('eterm', api);
