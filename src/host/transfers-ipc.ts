import { stat } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, posix } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { ProductError, normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import { DropTokenStore } from '../services/transfers/drop-tokens.ts';
import type { TransferQueue, TransferView } from '../services/transfers/queue.ts';
import { DROP_IPC, TRANSFERS_IPC, type IpcResult } from '../shared/ipc.ts';
import { requireSessionPort } from './session-capability.ts';
import { readRecord, readString } from './validate.ts';

const SESSION_ID_MAX = 64;
const PATH_MAX = 4096;
const MAX_DROP_FILES = 50;

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

async function pickUploadPaths(window: BrowserWindow): Promise<string[]> {
  if (process.env.ETERM_SMOKE === '1' && process.env.ETERM_SMOKE_UPLOAD) {
    return process.env.ETERM_SMOKE_UPLOAD.split(delimiter).filter((path) => path.trim().length > 0);
  }
  const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
  return result.canceled ? [] : result.filePaths;
}

async function validateUploadPath(path: string): Promise<void> {
  if (!isAbsolute(path) || path.length > PATH_MAX) {
    throw new ProductError('PERMISSION_DENIED', {
      message: '只能上传本地绝对路径',
      next: '从文件管理器拖入文件后重试',
    });
  }
  let stats;
  try {
    stats = await stat(path);
  } catch {
    throw new ProductError('FILE_NOT_FOUND', {
      message: '拖入的文件不存在',
      next: '重新从文件管理器拖入',
      detail: path,
    });
  }
  if (!stats.isFile()) {
    throw new ProductError('UNSUPPORTED', {
      message: '目录上传暂不支持',
      next: '先拖入文件；目录上传在后续版本支持',
      detail: path,
    });
  }
}

function readStringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new Error(`${label}必须是 1–${maxItems} 项`);
  }
  return value.map((item) => readString(item, label, maxLength));
}

function enqueueUploads(
  queue: TransferQueue,
  sessionId: string,
  remoteDir: string,
  localPaths: string[],
): TransferView[] {
  return localPaths.map((localPath) => {
    const name = basename(localPath);
    return queue.enqueue({
      sessionId,
      direction: 'upload',
      localPath,
      remotePath: posix.join(remoteDir, name),
      name,
    });
  });
}

async function pickDownloadPath(window: BrowserWindow, defaultName: string): Promise<string | null> {
  if (process.env.ETERM_SMOKE === '1' && process.env.ETERM_SMOKE_DOWNLOAD) {
    return process.env.ETERM_SMOKE_DOWNLOAD;
  }
  const result = await dialog.showSaveDialog(window, { defaultPath: defaultName });
  return result.canceled ? null : (result.filePath ?? null);
}

/** 本地路径来源：主进程对话框，或拖拽时 preload 用 webUtils 解析后注册的一次性 token。 */
export function registerTransfersIpc(
  queue: TransferQueue,
  sessions: Pick<SessionService, 'transferPort' | 'has'>,
  window: BrowserWindow,
): () => void {
  const dropTokens = new DropTokenStore();

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

  ipcMain.handle(TRANSFERS_IPC.pickUpload, async (_event, raw): Promise<IpcResult<TransferView[] | null>> => {
    try {
      const value = readRecord(raw, '上传参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      const remoteDir = readString(value.remoteDir, 'remoteDir', PATH_MAX);
      requireTransferSession(sessions, sessionId);

      const localPaths = await pickUploadPaths(window);
      if (localPaths.length === 0) return success(null);
      for (const path of localPaths) await validateUploadPath(path);
      return success(enqueueUploads(queue, sessionId, remoteDir, localPaths));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(DROP_IPC.register, async (_event, raw): Promise<IpcResult<string[]>> => {
    try {
      const paths = readStringArray(raw, '拖拽文件', MAX_DROP_FILES, PATH_MAX);
      for (const path of paths) await validateUploadPath(path);
      return success(dropTokens.register(paths));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(TRANSFERS_IPC.uploadDropped, async (_event, raw): Promise<IpcResult<TransferView[]>> => {
    try {
      const value = readRecord(raw, '拖拽上传参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      const remoteDir = readString(value.remoteDir, 'remoteDir', PATH_MAX);
      const tokens = readStringArray(value.tokens, '拖拽令牌', MAX_DROP_FILES, 64);
      requireTransferSession(sessions, sessionId);

      const localPaths = tokens.map((token) => {
        const path = dropTokens.take(token);
        if (!path) {
          throw new ProductError('UNSUPPORTED', {
            message: '拖拽已过期，请重新拖入',
            next: '重新从文件管理器拖入文件',
          });
        }
        return path;
      });
      return success(enqueueUploads(queue, sessionId, remoteDir, localPaths));
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
    for (const channel of [
      TRANSFERS_IPC.list,
      TRANSFERS_IPC.cancel,
      TRANSFERS_IPC.retry,
      TRANSFERS_IPC.pickUpload,
      TRANSFERS_IPC.pickDownload,
      TRANSFERS_IPC.uploadDropped,
      DROP_IPC.register,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
