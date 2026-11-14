import { mkdir } from 'node:fs/promises';
import { ipcMain, shell } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { ThemeStore } from '../services/themes/store.ts';
import { THEMES_IPC, type IpcResult } from '../shared/ipc.ts';
import type { ThemeDefinition } from '../shared/theme.ts';

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

/** 主题只读扫描 + 打开目录；写文件仍由用户自己完成，宿主不做导入器。 */
export function registerThemesIpc(store: ThemeStore): () => void {
  ipcMain.handle(THEMES_IPC.list, async (): Promise<IpcResult<ThemeDefinition[]>> => {
    try {
      return { ok: true, value: await store.list() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(THEMES_IPC.openDir, async (): Promise<IpcResult<null>> => {
    try {
      await mkdir(store.directory, { recursive: true });
      const error = await shell.openPath(store.directory);
      if (error) throw new Error(error);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [THEMES_IPC.list, THEMES_IPC.openDir]) {
      ipcMain.removeHandler(channel);
    }
  };
}
