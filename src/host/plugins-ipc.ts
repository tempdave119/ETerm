import { ipcMain, dialog, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { normalizeError } from '../core/errors.ts';
import type { PluginStore } from '../services/plugins/store.ts';
import { PLUGINS_IPC, type IpcResult } from '../shared/ipc.ts';
import type { PluginRecord } from '../shared/plugins.ts';
import { t } from '../shared/i18n/index.ts';
import { readRecord, readString } from './validate.ts';

interface PluginsIpcOptions {
  store: PluginStore;
  pluginsDir: string;
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readId(raw: unknown): string {
  return readString(raw, '插件 id', 64);
}

/** 插件的安装 / 启停 / 卸载；安装走系统目录选择框，不接受渲染层传路径。 */
export function registerPluginsIpc(options: PluginsIpcOptions): () => void {
  ipcMain.handle(PLUGINS_IPC.list, async (): Promise<IpcResult<PluginRecord[]>> => {
    try {
      return { ok: true, value: await options.store.list() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(PLUGINS_IPC.install, async (): Promise<IpcResult<PluginRecord | null>> => {
    try {
      const picked = await dialog.showOpenDialog({
        title: t('plugins.pickTitle'),
        properties: ['openDirectory'],
        message: t('plugins.pickHint'),
      });
      if (picked.canceled || picked.filePaths.length === 0) return { ok: true, value: null };
      return { ok: true, value: await options.store.install(picked.filePaths[0]!) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    PLUGINS_IPC.setEnabled,
    async (_event, raw): Promise<IpcResult<null>> => {
      try {
        const value = readRecord(raw, '插件启停参数');
        if (typeof value.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
        await options.store.setEnabled(readId(value.id), value.enabled);
        return { ok: true, value: null };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(PLUGINS_IPC.uninstall, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      await options.store.uninstall(readId(raw));
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(PLUGINS_IPC.openDir, async (): Promise<IpcResult<null>> => {
    try {
      await mkdir(options.pluginsDir, { recursive: true });
      const message = await shell.openPath(options.pluginsDir);
      if (message) throw new Error(message);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [
      PLUGINS_IPC.list,
      PLUGINS_IPC.install,
      PLUGINS_IPC.setEnabled,
      PLUGINS_IPC.uninstall,
      PLUGINS_IPC.openDir,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}