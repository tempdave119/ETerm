import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { LayoutStore } from '../services/layouts/store.ts';
import { LAYOUTS_IPC, type IpcResult, type LayoutTemplate, type PanelState } from '../shared/ipc.ts';
import { parsePanelState } from '../shared/panels.ts';
import { readRecord, readString } from './validate.ts';

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

export function registerLayoutsIpc(store: Pick<LayoutStore, 'get' | 'save' | 'getPanels' | 'savePanels'>): () => void {
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

  ipcMain.handle(LAYOUTS_IPC.panelsGet, async (): Promise<IpcResult<PanelState>> => {
    try {
      return { ok: true, value: await store.getPanels() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(LAYOUTS_IPC.panelsSave, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      await store.savePanels(parsePanelState(readRecord(raw, '面板状态')));
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [LAYOUTS_IPC.get, LAYOUTS_IPC.save, LAYOUTS_IPC.panelsGet, LAYOUTS_IPC.panelsSave]) {
      ipcMain.removeHandler(channel);
    }
  };
}
