import { ProductError, normalizeError, type ProductErrorInfo } from '../../core/errors.ts';
import type { TransferPort } from '../../core/ports.ts';

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface TransferRequest {
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  name: string;
}

export interface TransferView {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  name: string;
  status: TransferStatus;
  transferred: number;
  total: number;
  error?: ProductErrorInfo;
  createdAt: string;
  updatedAt: string;
}

export interface TransferQueueOptions {
  getPort(sessionId: string): TransferPort | null;
  onChange?(task: TransferView): void;
  maxConcurrent?: number;
  logger?: (message: string, detail?: unknown) => void;
}

interface Job {
  view: TransferView;
  port: TransferPort | null;
  portTaskId?: string;
}

let sequence = 0;

/**
 * 传输队列只管排队与状态，不碰协议；端口由 SessionService 按会话提供。
 * 默认单并发，避免同一连接上多路传输互相拖慢。
 */
export class TransferQueue {
  readonly #options: TransferQueueOptions;
  #maxConcurrent: number;
  #tasks = new Map<string, Job>();
  #pending: string[] = [];
  #running = 0;
  #progressOff = new Map<string, () => void>();
  #portTaskToJob = new Map<string, string>();
  #disposed = false;

  constructor(options: TransferQueueOptions) {
    this.#options = options;
    this.#maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
  }

  enqueue(request: TransferRequest): TransferView {
    if (this.#disposed) throw new Error('传输队列已关闭');
    this.#assertRequest(request);

    const now = new Date().toISOString();
    const view: TransferView = {
      id: `job-${++sequence}`,
      sessionId: request.sessionId,
      direction: request.direction,
      localPath: request.localPath,
      remotePath: request.remotePath,
      name: request.name,
      status: 'queued',
      transferred: 0,
      total: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.#tasks.set(view.id, { view, port: null });
    this.#pending.push(view.id);
    this.#emit(view);
    this.#pump();
    return structuredClone(view);
  }

  list(): TransferView[] {
    return [...this.#tasks.values()]
      .map((job) => structuredClone(job.view))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /** 并发数来自配置，改完即时生效：缩小不再启动新任务，放大立即补位。 */
  setMaxConcurrent(value: number): void {
    const next = Number.isFinite(value) ? Math.floor(value) : 1;
    this.#maxConcurrent = Math.max(1, next);
    this.#pump();
  }

  find(id: string): TransferView | null {
    const job = this.#tasks.get(id);
    return job ? structuredClone(job.view) : null;
  }

  cancel(id: string): void {
    const job = this.#tasks.get(id);
    if (!job) return;

    if (job.view.status === 'queued') {
      this.#pending = this.#pending.filter((pendingId) => pendingId !== id);
      this.#setStatus(job, 'canceled');
      return;
    }

    if (job.view.status === 'running') {
      this.#setStatus(job, 'canceled');
      if (job.port && job.portTaskId) job.port.cancel(job.portTaskId);
    }
  }

  retry(id: string): void {
    const job = this.#tasks.get(id);
    if (!job) return;
    if (job.view.status !== 'failed' && job.view.status !== 'canceled') return;

    job.view.transferred = 0;
    job.view.total = 0;
    job.view.error = undefined;
    job.portTaskId = undefined;
    job.port = null;
    this.#setStatus(job, 'queued');
    this.#pending.push(id);
    this.#pump();
  }

  dispose(): void {
    this.#disposed = true;
    for (const id of [...this.#tasks.keys()]) this.cancel(id);
    for (const off of this.#progressOff.values()) off();
    this.#progressOff.clear();
    this.#pending = [];
  }

  #pump(): void {
    while (!this.#disposed && this.#running < this.#maxConcurrent && this.#pending.length > 0) {
      const id = this.#pending.shift();
      if (id) this.#start(id);
    }
  }

  #start(id: string): void {
    const job = this.#tasks.get(id);
    if (!job || job.view.status !== 'queued') return;

    const port = this.#options.getPort(job.view.sessionId);
    if (!port) {
      job.view.error = new ProductError('UNSUPPORTED', {
        message: '会话已关闭，传输没有完成',
        next: '重新打开连接后再传',
      }).toInfo();
      this.#setStatus(job, 'failed');
      return;
    }

    job.port = port;
    this.#subscribe(job.view.sessionId, port);
    this.#setStatus(job, 'running');
    this.#running += 1;

    try {
      const task =
        job.view.direction === 'upload'
          ? port.upload(job.view.localPath, job.view.remotePath)
          : port.download(job.view.remotePath, job.view.localPath);
      job.portTaskId = task.id;
      this.#portTaskToJob.set(task.id, job.view.id);

      void task.done
        .then(() => this.#finish(job))
        .catch((error: unknown) => this.#fail(job, error))
        .finally(() => {
          this.#running -= 1;
          this.#pump();
        });
    } catch (error) {
      this.#fail(job, error);
      this.#running -= 1;
      this.#pump();
    }
  }

  #subscribe(sessionId: string, port: TransferPort): void {
    if (this.#progressOff.has(sessionId)) return;
    const off = port.onProgress((progress) => {
      const jobId = this.#portTaskToJob.get(progress.id);
      if (!jobId) return;
      const job = this.#tasks.get(jobId);
      if (!job || job.view.status !== 'running') return;
      job.view.transferred = progress.transferred;
      job.view.total = progress.total;
      job.view.updatedAt = new Date().toISOString();
      this.#emit(job.view);
    });
    this.#progressOff.set(sessionId, off);
  }

  #finish(job: Job): void {
    if (job.view.status !== 'running') return;
    job.view.transferred = job.view.total || job.view.transferred;
    this.#setStatus(job, 'done');
  }

  #fail(job: Job, error: unknown): void {
    if (job.view.status !== 'running') return;
    // 端口抛出的原始错误（fs / sftp / 链路）一律在队列边界翻成产品错误。
    job.view.error = normalizeError(error).toInfo();
    this.#setStatus(job, 'failed');
  }

  #setStatus(job: Job, status: TransferStatus): void {
    job.view.status = status;
    job.view.updatedAt = new Date().toISOString();
    this.#emit(job.view);
  }

  #emit(view: TransferView): void {
    this.#options.onChange?.(structuredClone(view));
  }

  #assertRequest(request: TransferRequest): void {
    if (!request.sessionId.trim()) throw new Error('sessionId 不能为空');
    if (request.direction !== 'upload' && request.direction !== 'download') {
      throw new Error(`传输方向无效：${String(request.direction)}`);
    }
    if (!request.localPath.trim() || !request.remotePath.trim()) {
      throw new Error('本地路径与远端路径不能为空');
    }
    if (!request.name.trim()) throw new Error('传输名称不能为空');
  }
}
