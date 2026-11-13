import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { SessionOpenOptions } from '../core/ports.ts';
import type { SessionService } from '../core/session-service.ts';
import { IPC, type IpcResult, type OpenedSession } from '../shared/ipc.ts';
import { readInteger, readRecord, readString } from './validate.ts';

const SESSION_ID_MAX = 64;
const PROTOCOL_MAX = 32;
const CWD_MAX = 4096;
const DATA_MAX = 1_000_000;
const ENV_ENTRIES_MAX = 64;
const ENV_VALUE_MAX = 8192;

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readOpenOptions(raw: unknown): SessionOpenOptions {
  const value = readRecord(raw, 'openSession 参数');
  const options: SessionOpenOptions = {
    protocol: readString(value.protocol, 'protocol', PROTOCOL_MAX),
    cols: readInteger(value.cols, 'cols', 2, 1000),
    rows: readInteger(value.rows, 'rows', 1, 1000),
  };

  if (value.cwd !== undefined) options.cwd = readString(value.cwd, 'cwd', CWD_MAX);
  if (value.env !== undefined) {
    const env = readRecord(value.env, 'env');
    const entries = Object.entries(env);
    if (entries.length > ENV_ENTRIES_MAX) throw new Error(`env 最多 ${ENV_ENTRIES_MAX} 项`);
    options.env = Object.fromEntries(
      entries.map(([key, envValue]) => [key, readString(envValue, `env.${key}`, ENV_VALUE_MAX)]),
    );
  }

  return options;
}

/** 只注册白名单通道；返回的注销函数在窗口关闭时调用，避免重复 handle。 */
export function registerSessionIpc(sessions: SessionService): () => void {
  ipcMain.handle(IPC.open, async (_event, raw): Promise<IpcResult<OpenedSession>> => {
    try {
      return success(await sessions.open(readOpenOptions(raw)));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(IPC.write, (_event, rawSessionId, rawData): IpcResult<null> => {
    try {
      const sessionId = readString(rawSessionId, 'sessionId', SESSION_ID_MAX);
      const data = readString(rawData, 'data', DATA_MAX);
      sessions.write(sessionId, data);
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(IPC.resize, (_event, rawSessionId, rawCols, rawRows): IpcResult<null> => {
    try {
      const sessionId = readString(rawSessionId, 'sessionId', SESSION_ID_MAX);
      const cols = readInteger(rawCols, 'cols', 2, 1000);
      const rows = readInteger(rawRows, 'rows', 1, 1000);
      sessions.resize(sessionId, cols, rows);
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(IPC.close, (_event, rawSessionId): IpcResult<null> => {
    try {
      sessions.close(readString(rawSessionId, 'sessionId', SESSION_ID_MAX));
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    ipcMain.removeHandler(IPC.open);
    ipcMain.removeHandler(IPC.write);
    ipcMain.removeHandler(IPC.resize);
    ipcMain.removeHandler(IPC.close);
  };
}
