import { join } from 'node:path';
import { JsonFile } from '../storage/json-file.ts';

export type SecretKind = 'password' | 'passphrase' | 'proxy-password';

export interface SecretCodec {
  encrypt(plain: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
}

export interface CredentialStoreOptions {
  baseDir: string;
  codec: SecretCodec;
  logger?: (message: string, detail?: unknown) => void;
}

const VERSION = 1;

interface CredentialsFile {
  version: number;
  entries: Record<string, string>;
}

/**
 * 只存密文：加密由宿主注入（Electron safeStorage），文件权限 0600。
 * 明文只在 set / get 的调用栈里停留，不落日志。
 */
export class CredentialStore {
  readonly #codec: SecretCodec;
  readonly #file: JsonFile<CredentialsFile>;

  constructor(options: CredentialStoreOptions) {
    this.#codec = options.codec;
    this.#file = new JsonFile<CredentialsFile>({
      filePath: join(options.baseDir, 'credentials.json'),
      empty: emptyFile,
      parse: parseFile,
      logger: options.logger,
      mode: 0o600,
    });
  }

  async set(connectionId: string, kind: SecretKind, secret: string): Promise<void> {
    const key = entryKey(connectionId, kind);
    const encrypted = await this.#codec.encrypt(secret);
    await this.#file.update((file) => {
      file.entries[key] = encrypted;
    });
  }

  async get(connectionId: string, kind: SecretKind): Promise<string | null> {
    const key = entryKey(connectionId, kind);
    const file = await this.#file.read();
    const payload = file.entries[key];
    if (!payload) return null;

    try {
      return await this.#codec.decrypt(payload);
    } catch (error) {
      throw new Error(`凭据解密失败：${connectionId} 的 ${kind}`, { cause: error });
    }
  }

  async has(connectionId: string, kind: SecretKind): Promise<boolean> {
    const file = await this.#file.read();
    return Boolean(file.entries[entryKey(connectionId, kind)]);
  }

  async remove(connectionId: string, kind: SecretKind): Promise<void> {
    const key = entryKey(connectionId, kind);
    await this.#file.update((file) => {
      delete file.entries[key];
    });
  }

  async removeAll(connectionId: string): Promise<void> {
    const prefix = `${connectionId}:`;
    await this.#file.update((file) => {
      for (const key of Object.keys(file.entries)) {
        if (key.startsWith(prefix)) delete file.entries[key];
      }
    });
  }
}

function entryKey(connectionId: string, kind: SecretKind): string {
  if (!connectionId.trim()) throw new Error('connectionId 不能为空');
  return `${connectionId}:${kind}`;
}

function emptyFile(): CredentialsFile {
  return { version: VERSION, entries: {} };
}

function parseFile(value: unknown): CredentialsFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('凭据文件根节点必须是对象');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION) throw new Error(`不支持的凭据文件版本：${String(record.version)}`);
  if (typeof record.entries !== 'object' || record.entries === null || Array.isArray(record.entries)) {
    throw new Error('凭据 entries 必须是对象');
  }

  const entries: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record.entries)) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`凭据条目无效：${key}`);
    }
    entries[key] = entry;
  }
  return { version: VERSION, entries };
}
