import { ipcMain } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeError } from '../core/errors.ts';
import { cpuSnapshot, readSystemStats, type CpuSnapshot } from '../services/system/stats.ts';
import { SYSTEM_IPC, type IpcResult, type SystemStats } from '../shared/ipc.ts';

/** 本机资源只读采样：渲染层每秒拉一次；首次调用先建基线再等 120ms，避免首屏永远是 0%。 */
export function registerSystemIpc(): () => void {
  let previous: CpuSnapshot | null = null;

  ipcMain.handle(SYSTEM_IPC.stats, async (): Promise<IpcResult<SystemStats>> => {
    try {
      if (!previous) {
        previous = cpuSnapshot();
        await delay(120);
      }
      const { stats, snapshot } = readSystemStats(previous);
      previous = snapshot;
      return { ok: true, value: stats };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => {
    ipcMain.removeHandler(SYSTEM_IPC.stats);
  };
}
