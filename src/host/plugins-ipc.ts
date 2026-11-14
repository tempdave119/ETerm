import { ipcMain, dialog, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { normalizeError } from '../core/errors.ts';
import type { PluginStore } from '../services/plugins/store.ts';
import type { PluginRuntime } from './plugin-runtime.ts';
import { PLUGINS_IPC, type IpcResult } from '../shared/ipc.ts';
import type { PluginCommandInfo, PluginRecord } from '../shared/plugins.ts';
import { t } from '../shared/i18n/index.ts';
import { readRecord, readString } from './validate.ts';

interface PluginsIpcOptions {
  store: PluginStore;
  runtime: PluginRuntime;
  pluginsDir: string;
  /** 插件总开关；关闭时拒绝安装 / 启停 / 卸载，只允许查看列表。 */
  isEnabled: () => Promise<boolean>;
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readId(raw: unknown): string {
  return readString(raw, '插件 id', 64);
}

const PANEL_MESSAGE_MAX = 256 * 1024;

async function requireEnabled(options: PluginsIpcOptions): Promise<void> {
  if (!(await options.isEnabled())) {
    throw new Error('插件未启用：先在 设置 → 插件 打开总开关');
  }
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
      await requireEnabled(options);
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
        await requireEnabled(options);
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
      await requireEnabled(options);
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

  ipcMain.handle(PLUGINS_IPC.listCommands, async (): Promise<IpcResult<PluginCommandInfo[]>> => {
    try {
      // 总开关刚打开时 runtime 可能还在异步加载，这里等一次，避免渲染层拿到空列表。
      if (await options.isEnabled()) await options.runtime.setEnabled(true);
      return { ok: true, value: options.runtime.listCommands() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(PLUGINS_IPC.runCommand, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      await options.runtime.runCommand(readId(raw));
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(PLUGINS_IPC.panelMessage, async (_event, raw): Promise<IpcResult<unknown>> => {
    try {
      const value = readRecord(raw, '插件面板消息');
      const pluginId = readString(value.pluginId, 'pluginId', 64);
      const panelId = readString(value.panelId, 'panelId', 64);
      const payload = value.payload ?? null;
      const serialized = JSON.stringify(payload);
      if (serialized.length > PANEL_MESSAGE_MAX) {
        throw new Error(`面板消息超过 ${PANEL_MESSAGE_MAX} 字节`);
      }
      return { ok: true, value: await options.runtime.handlePanelMessage(pluginId, panelId, payload) };
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
      PLUGINS_IPC.listCommands,
      PLUGINS_IPC.runCommand,
      PLUGINS_IPC.panelMessage,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}