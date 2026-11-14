import { mkdir } from 'node:fs/promises';
import { ipcMain, shell } from 'electron';
import { normalizeError } from '../core/errors.ts';
import {
  installComponentSamples,
  listComponentSamples,
  uninstallComponentSamples,
  type ComponentSampleDirs,
} from '../services/components/samples.ts';
import type { ComponentDescriptor, ComponentSample } from '../shared/components.ts';
import { COMPONENTS_IPC, type IpcResult } from '../shared/ipc.ts';
import { readString } from './validate.ts';

export interface ComponentsIpcOptions {
  getDescriptors: () => ComponentDescriptor[];
  sampleDirs: ComponentSampleDirs;
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

/** 可选组件只在启动时装载一次；示例组件按需复制到 userData，安装后需重启生效。 */
export function registerComponentsIpc(options: ComponentsIpcOptions): () => void {
  ipcMain.handle(COMPONENTS_IPC.list, (): IpcResult<ComponentDescriptor[]> => {
    return { ok: true, value: options.getDescriptors() };
  });

  ipcMain.handle(COMPONENTS_IPC.samples, async (): Promise<IpcResult<ComponentSample[]>> => {
    try {
      return { ok: true, value: await listComponentSamples(options.sampleDirs) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    COMPONENTS_IPC.installSamples,
    async (_event, rawIds): Promise<IpcResult<{ installed: string[]; skipped: string[] }>> => {
      try {
        // 单行重装传一个 id，底部按钮不传参数 = 补齐全部缺失示例。
        const ids = Array.isArray(rawIds)
          ? rawIds.map((rawId) => readString(rawId, '组件 id', 64))
          : undefined;
        return { ok: true, value: await installComponentSamples(options.sampleDirs, ids) };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    COMPONENTS_IPC.uninstallSample,
    async (_event, rawId): Promise<IpcResult<{ removed: string[]; skipped: string[] }>> => {
      try {
        const id = readString(rawId, '组件 id', 64);
        return { ok: true, value: await uninstallComponentSamples(options.sampleDirs, [id]) };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(COMPONENTS_IPC.openDir, async (): Promise<IpcResult<null>> => {
    try {
      await mkdir(options.sampleDirs.userDir, { recursive: true });
      const error = await shell.openPath(options.sampleDirs.userDir);
      if (error) throw new Error(error);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [
      COMPONENTS_IPC.list,
      COMPONENTS_IPC.samples,
      COMPONENTS_IPC.installSamples,
      COMPONENTS_IPC.uninstallSample,
      COMPONENTS_IPC.openDir,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
