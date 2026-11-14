import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { Transform, type Readable, type TransformCallback, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TransferPort, TransferProgress, TransferTask } from '../../core/ports.ts';

type VoidCallback = (error?: Error | null) => void;

/** 只抽用到的方法，测试里用普通对象替代 SFTPWrapper。 */
export interface SftpTransferLike {
  createReadStream(path: string): Readable;
  createWriteStream(path: string): Writable;
  stat(path: string, callback: (error: Error | null | undefined, stats: { size?: number }) => void): void;
  rename(from: string, to: string, callback: VoidCallback): void;
  unlink(path: string, callback: VoidCallback): void;
  /** OpenSSH 扩展：目标已存在时也能原子替换；服务端不支持时退回 rename。 */
  ext_openssh_rename?(from: string, to: string, callback: VoidCallback): void;
}

export interface TransferFsLike {
  createReadStream(path: string): Readable;
  createWriteStream(path: string): Writable;
  stat(path: string): Promise<{ size: number }>;
}

const defaultFs: TransferFsLike = {
  createReadStream: (path) => createReadStream(path),
  createWriteStream: (path) => createWriteStream(path),
  stat: (path) => stat(path),
};

interface TaskState {
  id: string;
  transferred: number;
  total: number;
  canceled: boolean;
  sourcePath?: string;
  targetPath?: string;
  tempPath?: string;
}

let sequence = 0;

/** 临时文件与目标同目录，保证 rename 不跨文件系统；隐藏命名避免在文件面板里扎眼。 */
function tempPathFor(targetPath: string, id: string): string {
  const directory = posix.dirname(targetPath);
  const base = posix.basename(targetPath);
  const safeBase = base.length > 120 ? base.slice(0, 120) : base;
  return posix.join(directory, `.${safeBase}.eterm-${id}.part`);
}

/** 清理失败不覆盖原始错误：用户需要看到真正失败的原因。 */
function removeRemoteFile(sftp: SftpTransferLike, path: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      sftp.unlink(path, () => resolve());
    } catch {
      resolve();
    }
  });
}

function renameRemote(sftp: SftpTransferLike, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error | null): void => {
      if (error) reject(error);
      else resolve();
    };

    if (sftp.ext_openssh_rename) {
      try {
        sftp.ext_openssh_rename(from, to, (error) => {
          // 扩展失败既可能是服务端不支持，也可能是权限问题；退回普通 rename 再定论。
          if (!error) resolve();
          else sftp.rename(from, to, done);
        });
        return;
      } catch {
        // 未声明 posix-rename 扩展时 ssh2 会同步抛错，直接走普通 rename。
      }
    }

    sftp.rename(from, to, done);
  });
}

async function finalizeUpload(sftp: SftpTransferLike, state: TaskState): Promise<void> {
  const tempPath = state.tempPath;
  const targetPath = state.targetPath;
  if (!tempPath || !targetPath) return;

  if (state.canceled) {
    await removeRemoteFile(sftp, tempPath);
    throw new Error('传输已取消');
  }

  try {
    await renameRemote(sftp, tempPath, targetPath);
  } catch (error) {
    await removeRemoteFile(sftp, tempPath);
    throw error;
  }
}

/**
 * 上传 / 下载都走流 + 计数 Transform：进度按实际字节、取消直接销毁两端流。
 * 队列、重试与并发由上层 TransferQueue 负责，端口只做单次传输。
 */
interface RunningTask {
  cancel(): void;
  pause(): void;
  resume(): void;
}

/**
 * 直接 pause 源读流不够：pipe 在目标 drain 时会自动 resume 源。
 * 在计数流前加一道闸门，暂停时扣住当前块的回调，背压会一路传回源流。
 */
function createPauseGate(): { stream: Transform; pause(): void; resume(): void } {
  let paused = false;
  let pending: { chunk: Buffer; callback: TransformCallback } | null = null;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (paused) {
        pending = { chunk, callback };
        return;
      }
      callback(null, chunk);
    },
  });

  return {
    stream,
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      const next = pending;
      pending = null;
      if (next) next.callback(null, next.chunk);
    },
  };
}

export function createTransferPort(sftp: SftpTransferLike, fsOps: TransferFsLike = defaultFs): TransferPort {
  const handlers = new Set<(progress: TransferProgress) => void>();
  const running = new Map<string, RunningTask>();

  const emit = (state: TaskState): void => {
    const progress: TransferProgress = {
      id: state.id,
      transferred: state.transferred,
      total: state.total,
    };
    for (const handler of handlers) handler(progress);
  };

  const start = (
    source: Readable,
    target: Writable,
    state: TaskState,
  ): TransferTask => {
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        state.transferred += chunk.length;
        emit(state);
        callback(null, chunk);
      },
    });

    const gate = createPauseGate();
    running.set(state.id, {
      cancel: () => {
        state.canceled = true;
        source.destroy();
        target.destroy();
      },
      // 闸门扣块后切断进度计数与下游写入，背压自然停住源流。
      pause: gate.pause,
      resume: gate.resume,
    });

    const done = pipeline(source, gate.stream, meter, target)
      .catch((error: unknown) => {
        throw state.canceled ? new Error('传输已取消') : error;
      })
      .finally(() => {
        running.delete(state.id);
      });

    return { id: state.id, done };
  };

  return {
    upload(sourcePath, targetPath) {
      const id = `transfer-${++sequence}`;
      const state: TaskState = {
        id,
        transferred: 0,
        total: 0,
        canceled: false,
        sourcePath,
        targetPath,
        tempPath: tempPathFor(targetPath, id),
      };
      const source = fsOps.createReadStream(sourcePath);
      const target = sftp.createWriteStream(state.tempPath as string);
      const task = start(source, target, state);
      const done = task.done
        .then(() => finalizeUpload(sftp, state))
        .catch(async (error: unknown) => {
          if (state.tempPath) await removeRemoteFile(sftp, state.tempPath);
          throw state.canceled ? new Error('传输已取消') : error;
        });
      fsOps
        .stat(sourcePath)
        .then((stats) => {
          state.total = stats.size;
          emit(state);
        })
        .catch(() => {});
      return { id: task.id, done };
    },

    download(sourcePath, targetPath) {
      const state: TaskState = { id: `transfer-${++sequence}`, transferred: 0, total: 0, canceled: false };
      const source = sftp.createReadStream(sourcePath);
      const target = fsOps.createWriteStream(targetPath);
      const task = start(source, target, state);
      sftp.stat(sourcePath, (error, stats) => {
        if (error || !stats?.size) return;
        state.total = stats.size;
        emit(state);
      });
      return task;
    },

    cancel(id) {
      running.get(id)?.cancel();
    },

    pause(id) {
      running.get(id)?.pause();
    },

    resume(id) {
      running.get(id)?.resume();
    },

    onProgress(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
