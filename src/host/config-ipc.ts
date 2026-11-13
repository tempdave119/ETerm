import { ipcMain, type BrowserWindow } from 'electron';
import { normalizeError } from '../core/errors.ts';
import { parseConfigInput, type AppConfig } from '../services/config/schema.ts';
import type { ConfigStore } from '../services/config/store.ts';
import { CONFIG_IPC, type IpcResult } from '../shared/ipc.ts';

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

/** 配置改动同时广播给渲染层与宿主（例如传输队列并发数），保证改完立即生效。 */
export function registerConfigIpc(
  store: ConfigStore,
  window: BrowserWindow,
  onApply?: (config: AppConfig) => void,
): () => void {
  const apply = (config: AppConfig): void => {
    if (!window.isDestroyed()) window.webContents.send(CONFIG_IPC.changed, config);
    onApply?.(config);
  };

  ipcMain.handle(CONFIG_IPC.get, async (): Promise<IpcResult<AppConfig>> => {
    try {
      return { ok: true, value: await store.get() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(CONFIG_IPC.save, async (_event, raw): Promise<IpcResult<AppConfig>> => {
    try {
      const saved = await store.save(parseConfigInput(raw));
      apply(saved);
      return { ok: true, value: saved };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(CONFIG_IPC.reset, async (): Promise<IpcResult<AppConfig>> => {
    try {
      const saved = await store.reset();
      apply(saved);
      return { ok: true, value: saved };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [CONFIG_IPC.get, CONFIG_IPC.save, CONFIG_IPC.reset]) {
      ipcMain.removeHandler(channel);
    }
  };
}
