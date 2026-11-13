import { randomUUID } from 'node:crypto';

interface DropTokenEntry {
  path: string;
  expiresAt: number;
}

export interface DropTokenStoreOptions {
  ttlMs?: number;
  now?: () => number;
  createId?: () => string;
}

/**
 * 拖拽上传的一次性路径令牌。
 * 渲染层只能拿到 token，拿不到可复用的本地路径；主进程校验文件后发 token，
 * uploadDropped 消费 token 时才还原路径，避免渲染层随意指定本机文件。
 */
export class DropTokenStore {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #tokens = new Map<string, DropTokenEntry>();

  constructor(options: DropTokenStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 60_000;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  register(paths: string[]): string[] {
    const now = this.#now();
    this.prune(now);
    return paths.map((path) => {
      const token = this.#createId();
      this.#tokens.set(token, { path, expiresAt: now + this.#ttlMs });
      return token;
    });
  }

  /** 单次消费：同一个 token 第二次取不到路径。 */
  take(token: string): string | null {
    const now = this.#now();
    this.prune(now);
    const entry = this.#tokens.get(token);
    if (!entry) return null;
    this.#tokens.delete(token);
    return entry.path;
  }

  prune(now = this.#now()): void {
    for (const [token, entry] of this.#tokens) {
      if (entry.expiresAt <= now) this.#tokens.delete(token);
    }
  }

  size(): number {
    return this.#tokens.size;
  }
}
