import { ipcMain } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import { cpuSnapshot, readSystemStats, type CpuSnapshot } from '../services/system/stats.ts';
import { parseRemoteStats, REMOTE_STATS_COMMAND } from '../services/system/remote-stats.ts';
import { SYSTEM_IPC, type IpcResult, type SystemStats } from '../shared/ipc.ts';
import { requireSessionPort } from './session-capability.ts';
import { readRecord, readString } from './validate.ts';

/** 本机资源只读采样：渲染层每秒拉一次；首次调用先建基线再等 120ms，避免首屏永远是 0%。 */
export function registerSystemIpc(sessions: Pick<SessionService, 'execPort' | 'has'>): () => void {
  let previous: CpuSnapshot | null = null;

  ipcMain.handle(SYSTEM_IPC.stats, async (): Promise<IpcResult<SystemStats>> => {
    try {
      if (!previous) {
        previous = cpuSnapshot();
        await delay(120);
      }
      const { stats, snapshot } = await readSystemStats(previous);
      previous = snapshot;
      return { ok: true, value: stats };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  ipcMain.handle(SYSTEM_IPC.remoteStats, async (_event, raw): Promise<IpcResult<SystemStats>> => {
    try {
      const value = readRecord(raw, '远端资源参数');
      const sessionId = readString(value.sessionId, 'sessionId', 64);
      const exec = requireSessionPort(sessions.execPort(sessionId), {
        sessionId,
        sessionAlive: sessions.has(sessionId),
        capability: 'exec',
      });
      const result = await exec.exec(REMOTE_STATS_COMMAND);
      if (!result.stdout.trim()) {
        throw new Error(result.stderr.trim() || `远端资源命令退出码 ${String(result.code ?? '未知')}`);
      }
      return { ok: true, value: parseRemoteStats(result.stdout) };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => {
    ipcMain.removeHandler(SYSTEM_IPC.stats);
    ipcMain.removeHandler(SYSTEM_IPC.remoteStats);
  };
}
