import { join } from 'node:path';
import { JsonFile } from '../storage/json-file.ts';

export type HostKeyStatus = 'new' | 'match' | 'changed';

export interface KnownHostsStoreOptions {
  baseDir: string;
  logger?: (message: string, detail?: unknown) => void;
}

const VERSION = 1;
const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]+$/;

interface KnownHostsFile {
  version: number;
  hosts: Record<string, string>;
}

/** 指纹按 host:port 记录；host 统一小写，IPv6 用方括号，避免同一台机器记成两条。 */
export class KnownHostsStore {
  readonly #file: JsonFile<KnownHostsFile>;

  constructor(options: KnownHostsStoreOptions) {
    this.#file = new JsonFile<KnownHostsFile>({
      filePath: join(options.baseDir, 'known_hosts.json'),
      empty: emptyFile,
      parse: parseFile,
      logger: options.logger,
    });
  }

  async get(host: string, port: number): Promise<string | null> {
    const file = await this.#file.read();
    return file.hosts[hostKey(host, port)] ?? null;
  }

  async remember(host: string, port: number, fingerprint: string): Promise<void> {
    if (!FINGERPRINT_PATTERN.test(fingerprint)) {
      throw new Error(`主机指纹格式无效：${fingerprint}`);
    }
    const key = hostKey(host, port);
    await this.#file.update((file) => {
      file.hosts[key] = fingerprint;
    });
  }

  async forget(host: string, port: number): Promise<void> {
    const key = hostKey(host, port);
    await this.#file.update((file) => {
      delete file.hosts[key];
    });
  }

  async verify(host: string, port: number, fingerprint: string): Promise<HostKeyStatus> {
    const known = await this.get(host, port);
    if (!known) return 'new';
    return known === fingerprint ? 'match' : 'changed';
  }
}

function hostKey(host: string, port: number): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) throw new Error('host 不能为空');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`port 必须是 1–65535 的整数：${String(port)}`);
  }
  return normalized.includes(':') ? `[${normalized}]:${port}` : `${normalized}:${port}`;
}

function emptyFile(): KnownHostsFile {
  return { version: VERSION, hosts: {} };
}

function parseFile(value: unknown): KnownHostsFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('known_hosts 根节点必须是对象');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION) throw new Error(`不支持的 known_hosts 版本：${String(record.version)}`);
  if (typeof record.hosts !== 'object' || record.hosts === null || Array.isArray(record.hosts)) {
    throw new Error('known_hosts hosts 必须是对象');
  }

  const hosts: Record<string, string> = {};
  for (const [key, fingerprint] of Object.entries(record.hosts)) {
    if (typeof fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(fingerprint)) {
      throw new Error(`known_hosts 条目无效：${key}`);
    }
    hosts[key] = fingerprint;
  }
  return { version: VERSION, hosts };
}
