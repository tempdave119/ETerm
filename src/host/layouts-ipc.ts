import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { LayoutStore } from '../services/layouts/store.ts';
import { LAYOUTS_IPC, type IpcResult, type LayoutTemplate } from '../shared/ipc.ts';
import { readRecord, readString } from './validate.ts';

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

export function registerLayoutsIpc(store: Pick<LayoutStore, 'get' | 'save'>): () => void {
  ipcMain.handle(LAYOUTS_IPC.get, async (_event, rawKey): Promise<IpcResult<LayoutTemplate | null>> => {
    try {
      return { ok: true, value: await store.get(readString(rawKey, '布局 key', 64)) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(LAYOUTS_IPC.save, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const value = readRecord(raw, '布局参数');
      const key = readString(value.key, '布局 key', 64);
      await store.save(key, value.template as LayoutTemplate);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    ipcMain.removeHandler(LAYOUTS_IPC.get);
    ipcMain.removeHandler(LAYOUTS_IPC.save);
  };
}
