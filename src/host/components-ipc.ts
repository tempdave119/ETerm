import { ipcMain } from 'electron';
import type { ComponentDescriptor } from '../shared/components.ts';
import { COMPONENTS_IPC, type IpcResult } from '../shared/ipc.ts';

/** 可选组件只在启动时装载一次，这里只把已装载的协议与字段表交给渲染层。 */
export function registerComponentsIpc(getDescriptors: () => ComponentDescriptor[]): () => void {
  ipcMain.handle(COMPONENTS_IPC.list, (): IpcResult<ComponentDescriptor[]> => {
    return { ok: true, value: getDescriptors() };
  });

  return () => ipcMain.removeHandler(COMPONENTS_IPC.list);
}
