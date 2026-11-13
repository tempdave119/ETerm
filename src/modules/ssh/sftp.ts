import { ProductError, normalizeError } from '../../core/errors.ts';
import type { FileEntry, FileEntryType, FilePort } from '../../core/ports.ts';
import { baseName, joinRemote } from './path.ts';

export interface RemoteStats {
  size?: number;
  mtime?: number;
  mode?: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface RemoteEntry {
  filename: string;
  attrs: RemoteStats;
}

type NodeCallback<T> = (error?: Error | null, value?: T) => void;
type VoidCallback = (error?: Error | null) => void;

/** 只抽用到的方法，测试里可以用普通对象替代 SFTPWrapper。 */
export interface SftpLike {
  readdir(path: string, callback: NodeCallback<RemoteEntry[]>): void;
  stat(path: string, callback: NodeCallback<RemoteStats>): void;
  mkdir(path: string, callback: VoidCallback): void;
  rename(from: string, to: string, callback: VoidCallback): void;
  unlink(path: string, callback: VoidCallback): void;
  rmdir(path: string, callback: VoidCallback): void;
  readFile(path: string, callback: NodeCallback<Buffer>): void;
  writeFile(path: string, data: Buffer, callback: VoidCallback): void;
}

function call<T>(path: string, run: (callback: NodeCallback<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run((error, value) => {
      if (error) reject(mapSftpError(error, path));
      else resolve(value as T);
    });
  });
}

// SFTP 状态码比文案稳定：2 = 不存在，3 = 权限不足，其余交给通用归一。
function mapSftpError(error: Error, path: string): ProductError {
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'number' ? record.code : undefined;
  const message = typeof record.message === 'string' ? record.message : String(error);

  if (code === 2) return new ProductError('FILE_NOT_FOUND', { detail: `${path}: ${message}` });
  if (code === 3) return new ProductError('PERMISSION_DENIED', { detail: `${path}: ${message}` });
  return normalizeError(error);
}

function typeOf(stats: RemoteStats): FileEntryType {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function toEntry(path: string, name: string, stats: RemoteStats): FileEntry {
  return {
    name,
    path,
    type: typeOf(stats),
    size: stats.size ?? 0,
    mtimeMs: (stats.mtime ?? 0) * 1000,
    mode: stats.mode ?? 0,
  };
}

export function createFilePort(sftp: SftpLike): FilePort {
  return {
    async list(path) {
      const entries = await call<RemoteEntry[]>(path, (callback) => sftp.readdir(path, callback));
      return entries.map((entry) => toEntry(joinRemote(path, entry.filename), entry.filename, entry.attrs));
    },

    async stat(path) {
      const stats = await call<RemoteStats>(path, (callback) => sftp.stat(path, callback));
      return toEntry(path, baseName(path), stats);
    },

    mkdir: (path) => call<void>(path, (callback) => sftp.mkdir(path, callback)),
    rename: (from, to) => call<void>(from, (callback) => sftp.rename(from, to, callback)),

    async remove(path) {
      const stats = await call<RemoteStats>(path, (callback) => sftp.stat(path, callback));
      if (stats.isDirectory()) {
        await call<void>(path, (callback) => sftp.rmdir(path, callback));
        return;
      }
      await call<void>(path, (callback) => sftp.unlink(path, callback));
    },

    read: (path) => call<Buffer>(path, (callback) => sftp.readFile(path, callback)),

    write: (path, data) => call<void>(path, (callback) => sftp.writeFile(path, Buffer.from(data), callback)),
  };
}
