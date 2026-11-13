import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TransferPort, TransferProgress, TransferTask } from '../../core/ports.ts';

/** 只抽用到的方法，测试里用普通对象替代 SFTPWrapper。 */
export interface SftpTransferLike {
  createReadStream(path: string): Readable;
  createWriteStream(path: string): Writable;
  stat(path: string, callback: (error: Error | null | undefined, stats: { size?: number }) => void): void;
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
}

let sequence = 0;

/**
 * 上传 / 下载都走流 + 计数 Transform：进度按实际字节、取消直接销毁两端流。
 * 队列、重试与并发由上层 TransferQueue 负责，端口只做单次传输。
 */
export function createTransferPort(sftp: SftpTransferLike, fsOps: TransferFsLike = defaultFs): TransferPort {
  const handlers = new Set<(progress: TransferProgress) => void>();
  const running = new Map<string, () => void>();

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

    running.set(state.id, () => {
      state.canceled = true;
      source.destroy();
      target.destroy();
    });

    const done = pipeline(source, meter, target)
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
      const state: TaskState = { id: `transfer-${++sequence}`, transferred: 0, total: 0, canceled: false };
      const source = fsOps.createReadStream(sourcePath);
      const target = sftp.createWriteStream(targetPath);
      const task = start(source, target, state);
      fsOps
        .stat(sourcePath)
        .then((stats) => {
          state.total = stats.size;
          emit(state);
        })
        .catch(() => {});
      return task;
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
      const cancel = running.get(id);
      if (cancel) cancel();
    },

    onProgress(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
