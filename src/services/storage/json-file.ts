import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface JsonFileOptions<T> {
  filePath: string;
  empty: () => T;
  parse: (value: unknown) => T;
  logger?: (message: string, detail?: unknown) => void;
  /** 敏感文件用 0600，普通数据用默认值。 */
  mode?: number;
}

/**
 * 一个 JSON 文件的读写壳：读取缓存、解析失败先备份再回退、写入按临时文件 + rename。
 * 只负责文件层，不掺业务校验。
 */
export class JsonFile<T> {
  readonly #filePath: string;
  readonly #empty: () => T;
  readonly #parse: (value: unknown) => T;
  readonly #log: (message: string, detail?: unknown) => void;
  readonly #mode: number;
  #cache: T | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: JsonFileOptions<T>) {
    this.#filePath = options.filePath;
    this.#empty = options.empty;
    this.#parse = options.parse;
    this.#mode = options.mode ?? 0o644;
    this.#log =
      options.logger ??
      ((message, detail) => {
        if (detail === undefined) console.warn(`[json-file] ${message}`);
        else console.warn(`[json-file] ${message}`, detail);
      });
  }

  async read(): Promise<T> {
    if (this.#cache) return this.#cache;

    let raw: string;
    try {
      raw = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        this.#cache = this.#empty();
        return this.#cache;
      }
      throw error;
    }

    try {
      this.#cache = this.#parse(JSON.parse(raw));
    } catch (error) {
      this.#log(`${this.#filePath} 无法解析，已备份并回退为空数据`, error);
      await this.#backupBrokenFile();
      this.#cache = this.#empty();
    }
    return this.#cache;
  }

  async update<R>(change: (value: T) => R | Promise<R>): Promise<R> {
    const run = this.#queue.then(async () => {
      const value = await this.read();
      const result = await change(value);
      await this.#write(value);
      return result;
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #write(value: T): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: this.#mode,
    });
    await rename(tempPath, this.#filePath);
  }

  async #backupBrokenFile(): Promise<void> {
    const backupPath = `${this.#filePath}.broken-${Date.now()}`;
    try {
      await rename(this.#filePath, backupPath);
    } catch (error) {
      this.#log(`备份损坏文件失败：${this.#filePath}`, error);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
