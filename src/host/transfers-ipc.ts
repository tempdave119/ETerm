import { basename, posix } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import type { TransferQueue, TransferView } from '../services/transfers/queue.ts';
import { TRANSFERS_IPC, type IpcResult } from '../shared/ipc.ts';
import { requireSessionPort } from './session-capability.ts';
import { readRecord, readString } from './validate.ts';

const SESSION_ID_MAX = 64;
const PATH_MAX = 4096;

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function requireTransferSession(sessions: Pick<SessionService, 'transferPort' | 'has'>, sessionId: string): void {
  requireSessionPort(sessions.transferPort(sessionId), {
    sessionId,
    sessionAlive: sessions.has(sessionId),
    capability: 'transfer',
  });
}

async function pickUploadPath(window: BrowserWindow): Promise<string | null> {
  if (process.env.ETERM_SMOKE === '1' && process.env.ETERM_SMOKE_UPLOAD) {
    return process.env.ETERM_SMOKE_UPLOAD;
  }
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function pickDownloadPath(window: BrowserWindow, defaultName: string): Promise<string | null> {
  if (process.env.ETERM_SMOKE === '1' && process.env.ETERM_SMOKE_DOWNLOAD) {
    return process.env.ETERM_SMOKE_DOWNLOAD;
  }
  const result = await dialog.showSaveDialog(window, { defaultPath: defaultName });
  return result.canceled ? null : (result.filePath ?? null);
}

/** 本地路径只由主进程文件对话框给出，渲染层永远不传本地路径。 */
export function registerTransfersIpc(
  queue: TransferQueue,
  sessions: Pick<SessionService, 'transferPort' | 'has'>,
  window: BrowserWindow,
): () => void {
  ipcMain.handle(TRANSFERS_IPC.list, (): IpcResult<TransferView[]> => success(queue.list()));

  ipcMain.handle(TRANSFERS_IPC.cancel, (_event, rawId): IpcResult<null> => {
    try {
      queue.cancel(readString(rawId, '传输 id', 64));
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(TRANSFERS_IPC.retry, (_event, rawId): IpcResult<null> => {
    try {
      queue.retry(readString(rawId, '传输 id', 64));
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(TRANSFERS_IPC.pickUpload, async (_event, raw): Promise<IpcResult<TransferView | null>> => {
    try {
      const value = readRecord(raw, '上传参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      const remoteDir = readString(value.remoteDir, 'remoteDir', PATH_MAX);
      requireTransferSession(sessions, sessionId);

      const localPath = await pickUploadPath(window);
      if (!localPath) return success(null);

      const name = basename(localPath);
      const view = queue.enqueue({
        sessionId,
        direction: 'upload',
        localPath,
        remotePath: posix.join(remoteDir, name),
        name,
      });
      return success(view);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(TRANSFERS_IPC.pickDownload, async (_event, raw): Promise<IpcResult<TransferView | null>> => {
    try {
      const value = readRecord(raw, '下载参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      const remotePath = readString(value.remotePath, 'remotePath', PATH_MAX);
      requireTransferSession(sessions, sessionId);

      const name = posix.basename(remotePath);
      const localPath = await pickDownloadPath(window, name);
      if (!localPath) return success(null);

      const view = queue.enqueue({
        sessionId,
        direction: 'download',
        localPath,
        remotePath,
        name,
      });
      return success(view);
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [TRANSFERS_IPC.list, TRANSFERS_IPC.cancel, TRANSFERS_IPC.retry, TRANSFERS_IPC.pickUpload, TRANSFERS_IPC.pickDownload]) {
      ipcMain.removeHandler(channel);
    }
  };
}
