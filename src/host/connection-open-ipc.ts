import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import { CONNECTION_IPC, type IpcResult, type OpenedSession } from '../shared/ipc.ts';
import { readInteger, readRecord, readString } from './validate.ts';
import { resolveOpenOptions, type ResolverDeps } from './resolve-connection.ts';

export function registerConnectionOpenIpc(sessions: SessionService, deps: ResolverDeps): () => void {
  ipcMain.handle(CONNECTION_IPC.open, async (_event, raw): Promise<IpcResult<OpenedSession>> => {
    try {
      const value = readRecord(raw, '连接会话参数');
      const options = {
        connectionId: readString(value.connectionId, 'connectionId', 64),
        cols: readInteger(value.cols, 'cols', 2, 1000),
        rows: readInteger(value.rows, 'rows', 1, 1000),
      };
      return { ok: true, value: await sessions.open(await resolveOpenOptions(options, deps)) };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => ipcMain.removeHandler(CONNECTION_IPC.open);
}
