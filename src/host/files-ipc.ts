import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import { FILES_IPC, type FileEntry, type FilePreview, type IpcResult } from '../shared/ipc.ts';
import { requireSessionPort } from './session-capability.ts';
import { readRecord, readString } from './validate.ts';

const SESSION_ID_MAX = 64;
const PATH_MAX = 4096;
const PREVIEW_LIMIT = 256 * 1024;
const BINARY_SNIFF = 8192;

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readRequest(raw: unknown): { sessionId: string; path: string } {
  const value = readRecord(raw, '文件参数');
  return {
    sessionId: readString(value.sessionId, 'sessionId', SESSION_ID_MAX),
    path: readString(value.path, 'path', PATH_MAX),
  };
}

function readRenameRequest(raw: unknown): { sessionId: string; path: string; nextPath: string } {
  const value = readRecord(raw, '重命名参数');
  return {
    sessionId: readString(value.sessionId, 'sessionId', SESSION_ID_MAX),
    path: readString(value.path, 'path', PATH_MAX),
    nextPath: readString(value.nextPath, 'nextPath', PATH_MAX),
  };
}

function requireFilePort(sessions: SessionService, sessionId: string) {
  return requireSessionPort(sessions.filePort(sessionId), {
    sessionId,
    sessionAlive: sessions.has(sessionId),
    capability: 'file',
  });
}

/** 文件面板做浏览、只读预览与目录操作；上传下载属于 F-11 传输队列。 */
export function registerFilesIpc(sessions: SessionService): () => void {
  ipcMain.handle(FILES_IPC.list, async (_event, raw): Promise<IpcResult<FileEntry[]>> => {
    try {
      const { sessionId, path } = readRequest(raw);
      return { ok: true, value: await requireFilePort(sessions, sessionId).list(path) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FILES_IPC.mkdir, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const { sessionId, path } = readRequest(raw);
      await requireFilePort(sessions, sessionId).mkdir(path);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FILES_IPC.rename, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const { sessionId, path, nextPath } = readRenameRequest(raw);
      await requireFilePort(sessions, sessionId).rename(path, nextPath);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FILES_IPC.remove, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const { sessionId, path } = readRequest(raw);
      await requireFilePort(sessions, sessionId).remove(path);
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FILES_IPC.read, async (_event, raw): Promise<IpcResult<FilePreview>> => {
    try {
      const { sessionId, path } = readRequest(raw);
      const data = await requireFilePort(sessions, sessionId).read(path);
      const binary = data.subarray(0, BINARY_SNIFF).includes(0);
      const limited = data.subarray(0, PREVIEW_LIMIT);
      return {
        ok: true,
        value: {
          path,
          content: binary ? '' : Buffer.from(limited).toString('utf8'),
          truncated: data.length > PREVIEW_LIMIT,
          binary,
        },
      };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    ipcMain.removeHandler(FILES_IPC.list);
    ipcMain.removeHandler(FILES_IPC.read);
    ipcMain.removeHandler(FILES_IPC.mkdir);
    ipcMain.removeHandler(FILES_IPC.rename);
    ipcMain.removeHandler(FILES_IPC.remove);
  };
}
