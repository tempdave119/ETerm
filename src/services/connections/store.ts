import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CONNECTIONS_FILE_VERSION,
  type AuthMethod,
  type ConnectionInput,
  type ConnectionProtocol,
  type ConnectionProxy,
  type ConnectionRecord,
  type ConnectionsFile,
  type ConnectionsSnapshot,
  type GroupInput,
  type GroupRecord,
} from './types.ts';

export type StoreLogger = (message: string, detail?: unknown) => void;

export interface ConnectionStoreOptions {
  baseDir: string;
  logger?: StoreLogger;
}

const AUTH_METHODS: AuthMethod[] = ['password', 'key', 'agent', 'none'];
const PROTOCOLS: ConnectionProtocol[] = ['ssh', 'local'];

/**
 * 连接与分组的唯一存储入口。
 * 写入走临时文件 + rename，读到坏文件先备份再回退空数据，绝不静默丢用户配置。
 */
export class ConnectionStore {
  readonly #filePath: string;
  readonly #log: StoreLogger;
  #cache: ConnectionsFile | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: ConnectionStoreOptions) {
    this.#filePath = join(options.baseDir, 'connections.json');
    this.#log =
      options.logger ??
      ((message, detail) => {
        if (detail === undefined) console.warn(`[connections] ${message}`);
        else console.warn(`[connections] ${message}`, detail);
      });
  }

  async list(): Promise<ConnectionsSnapshot> {
    const file = await this.#load();
    const snapshot = structuredClone(file);
    snapshot.groups.sort(byOrder);
    snapshot.connections.sort(byOrder);
    return { groups: snapshot.groups, connections: snapshot.connections };
  }

  async getConnection(id: string): Promise<ConnectionRecord | null> {
    const file = await this.#load();
    return structuredClone(file.connections.find((item) => item.id === id) ?? null);
  }

  async saveConnection(input: ConnectionInput): Promise<ConnectionRecord> {
    return this.#mutate((file) => {
      const normalized = normalizeConnection(input, file);
      const index = file.connections.findIndex((item) => item.id === normalized.id);

      if (index >= 0) {
        const existing = file.connections[index]!;
        const record: ConnectionRecord = {
          ...normalized,
          order: existing.order,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
        file.connections[index] = record;
        return record;
      }

      if (input.id) throw new Error(`连接不存在：${input.id}`);
      const now = new Date().toISOString();
      const record: ConnectionRecord = {
        ...normalized,
        order: nextOrder(file.connections),
        createdAt: now,
        updatedAt: now,
      };
      file.connections.push(record);
      return record;
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.#mutate((file) => {
      const index = file.connections.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`连接不存在：${id}`);
      file.connections.splice(index, 1);
      // 被删的连接若仍被当作跳板，一并解除引用，避免留下打不开的连接。
      for (const connection of file.connections) {
        if (connection.jumpConnectionId === id) delete connection.jumpConnectionId;
      }
    });
  }

  async reorderConnections(orderedIds: string[]): Promise<void> {
    await this.#mutate((file) => {
      const known = new Set(file.connections.map((connection) => connection.id));
      if (orderedIds.length !== known.size) throw new Error('排序列表必须包含全部连接');

      const seen = new Set<string>();
      for (const id of orderedIds) {
        if (!known.has(id) || seen.has(id)) throw new Error(`排序列表无效：${id}`);
        seen.add(id);
      }

      const byId = new Map(file.connections.map((connection) => [connection.id, connection]));
      orderedIds.forEach((id, index) => {
        const connection = byId.get(id);
        if (connection) connection.order = index;
      });
    });
  }

  async saveGroup(input: GroupInput): Promise<GroupRecord> {
    return this.#mutate((file) => {
      const name = requireString(input.name, '分组名称', 120);
      const duplicate = file.groups.find(
        (group) => group.name.toLowerCase() === name.toLowerCase() && group.id !== input.id,
      );
      if (duplicate) throw new Error(`分组名已存在：${name}`);

      if (input.id) {
        const index = file.groups.findIndex((group) => group.id === input.id);
        if (index < 0) throw new Error(`分组不存在：${input.id}`);
        const record: GroupRecord = { ...file.groups[index]!, name };
        file.groups[index] = record;
        return record;
      }

      const record: GroupRecord = { id: randomUUID(), name, order: nextOrder(file.groups) };
      file.groups.push(record);
      return record;
    });
  }

  async deleteGroup(id: string): Promise<void> {
    await this.#mutate((file) => {
      const index = file.groups.findIndex((group) => group.id === id);
      if (index < 0) throw new Error(`分组不存在：${id}`);
      file.groups.splice(index, 1);
      // 分组只是归类，删除分组不删连接，归入未分组。
      for (const connection of file.connections) {
        if (connection.groupId === id) connection.groupId = null;
      }
    });
  }

  #mutate<T>(change: (file: ConnectionsFile) => T): Promise<T> {
    const run = this.#queue.then(async () => {
      const file = await this.#load();
      const result = change(file);
      await this.#persist(file);
      return result;
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #load(): Promise<ConnectionsFile> {
    if (this.#cache) return this.#cache;

    let raw: string;
    try {
      raw = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        this.#cache = emptyFile();
        return this.#cache;
      }
      throw error;
    }

    try {
      this.#cache = parseFile(JSON.parse(raw));
    } catch (error) {
      this.#log('connections.json 无法解析，已备份并回退为空数据', error);
      await this.#backupBrokenFile();
      this.#cache = emptyFile();
    }
    return this.#cache;
  }

  async #backupBrokenFile(): Promise<void> {
    const backupPath = `${this.#filePath}.broken-${Date.now()}`;
    try {
      await rename(this.#filePath, backupPath);
    } catch (error) {
      this.#log('备份损坏的 connections.json 失败', error);
    }
  }

  async #persist(file: ConnectionsFile): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.#filePath);
  }
}

function emptyFile(): ConnectionsFile {
  return { version: CONNECTIONS_FILE_VERSION, groups: [], connections: [] };
}

function byOrder(left: { order: number }, right: { order: number }): number {
  return left.order - right.order;
}

function nextOrder(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

function requireString(value: unknown, label: string, maxLength: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new Error(`${label} 必须是 1–${maxLength} 字符的字符串`);
  }
  return trimmed;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, label, maxLength);
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

function normalizeConnection(
  input: ConnectionInput,
  file: ConnectionsFile,
): Omit<ConnectionRecord, 'order' | 'createdAt' | 'updatedAt'> {
  const id = input.id ? requireString(input.id, '连接 id', 64) : randomUUID();
  const name = requireString(input.name, '连接名称', 120);

  if (!PROTOCOLS.includes(input.protocol)) {
    throw new Error(`连接协议必须是 ssh 或 local`);
  }
  const auth = input.auth ?? (input.protocol === 'ssh' ? 'password' : 'none');
  if (!AUTH_METHODS.includes(auth)) throw new Error(`认证方式无效：${String(auth)}`);
  if (input.protocol === 'local' && auth !== 'none') {
    throw new Error('本地终端不需要认证方式');
  }

  const groupId = input.groupId ?? null;
  if (groupId !== null) {
    const group = file.groups.find((item) => item.id === groupId);
    if (!group) throw new Error(`分组不存在：${groupId}`);
  }

  if (input.protocol === 'local') {
    if (input.jumpConnectionId) throw new Error('本地终端不能设置跳板机');
    if (input.proxy) throw new Error('本地终端不能设置代理');
    return { id, name, protocol: 'local', auth, groupId };
  }

  const proxy = input.proxy ? normalizeProxy(input.proxy) : undefined;

  const jumpConnectionId = optionalString(input.jumpConnectionId, '跳板机连接 id', 64);
  if (jumpConnectionId) {
    if (jumpConnectionId === id) throw new Error('跳板机不能是自己');
    const jump = file.connections.find((item) => item.id === jumpConnectionId);
    if (!jump || jump.protocol !== 'ssh') throw new Error(`跳板机连接不存在：${jumpConnectionId}`);
    assertNoJumpCycle(file, id, jumpConnectionId);
  }

  return {
    id,
    name,
    protocol: 'ssh',
    host: requireString(input.host, '主机', 255),
    port: input.port === undefined ? 22 : requireInteger(input.port, '端口', 1, 65535),
    username: requireString(input.username, '用户名', 255),
    auth,
    groupId,
    keyPath: optionalString(input.keyPath, '私钥路径', 4096),
    jumpConnectionId,
    proxy,
  };
}

function normalizeProxy(value: ConnectionProxy): ConnectionProxy {
  if (value.type !== 'http' && value.type !== 'socks5') {
    throw new Error('代理类型必须是 http 或 socks5');
  }
  return {
    type: value.type,
    host: requireString(value.host, '代理主机', 255),
    port: requireInteger(value.port, '代理端口', 1, 65535),
  };
}

/** 保存时就把环挡住，避免运行时再碰到 A→B→A 的跳板链。 */
function assertNoJumpCycle(file: ConnectionsFile, id: string, jumpId: string): void {
  let current: string | undefined = jumpId;
  const seen = new Set<string>();
  while (current) {
    if (current === id) throw new Error('跳板链存在循环');
    if (seen.has(current)) throw new Error('跳板链存在循环');
    seen.add(current);
    if (seen.size > 16) throw new Error('跳板链太深');
    current = file.connections.find((item) => item.id === current)?.jumpConnectionId;
  }
}

function parseFile(value: unknown): ConnectionsFile {
  if (!isRecord(value)) throw new Error('根节点必须是对象');
  if (value.version !== CONNECTIONS_FILE_VERSION) {
    throw new Error(`不支持的文件版本：${String(value.version)}`);
  }
  if (!Array.isArray(value.groups) || !Array.isArray(value.connections)) {
    throw new Error('groups / connections 必须是数组');
  }

  const groups = value.groups.map(parseGroup);
  const connections = value.connections.map(parseConnection);
  assertUniqueIds(groups, connections);

  return { version: CONNECTIONS_FILE_VERSION, groups, connections };
}

function parseGroup(value: unknown): GroupRecord {
  const record = asRecord(value, '分组');
  return {
    id: requireString(record.id, '分组 id', 64),
    name: requireString(record.name, '分组名称', 120),
    order: requireInteger(record.order, '分组排序', 0, 1_000_000),
  };
}

function parseConnection(value: unknown): ConnectionRecord {
  const record = asRecord(value, '连接');
  const protocol = record.protocol === 'ssh' || record.protocol === 'local' ? record.protocol : null;
  if (!protocol) throw new Error('连接协议无效');

  const auth = record.auth;
  if (typeof auth !== 'string' || !AUTH_METHODS.includes(auth as AuthMethod)) {
    throw new Error('连接认证方式无效');
  }

  const groupId = record.groupId ?? null;
  if (groupId !== null && typeof groupId !== 'string') throw new Error('连接分组无效');

  const base: Omit<ConnectionRecord, 'host' | 'port' | 'username' | 'keyPath'> = {
    id: requireString(record.id, '连接 id', 64),
    name: requireString(record.name, '连接名称', 120),
    protocol,
    auth: auth as AuthMethod,
    groupId: groupId as string | null,
    order: requireInteger(record.order, '连接排序', 0, 1_000_000),
    createdAt: requireString(record.createdAt, '创建时间', 64),
    updatedAt: requireString(record.updatedAt, '更新时间', 64),
  };

  if (protocol === 'local') return base;

  return {
    ...base,
    host: requireString(record.host, '主机', 255),
    port: requireInteger(record.port, '端口', 1, 65535),
    username: requireString(record.username, '用户名', 255),
    keyPath: optionalString(record.keyPath, '私钥路径', 4096),
    jumpConnectionId: optionalString(record.jumpConnectionId, '跳板机连接 id', 64),
    proxy: parseProxy(record.proxy),
  };
}

function parseProxy(value: unknown): ConnectionProxy | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, '代理');
  const type = record.type === 'http' || record.type === 'socks5' ? record.type : null;
  if (!type) throw new Error('代理类型无效');
  return {
    type,
    host: requireString(record.host, '代理主机', 255),
    port: requireInteger(record.port, '代理端口', 1, 65535),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function assertUniqueIds(groups: GroupRecord[], connections: ConnectionRecord[]): void {
  const ids = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`分组 id 重复：${group.id}`);
    ids.add(group.id);
  }
  for (const connection of connections) {
    if (ids.has(connection.id)) throw new Error(`连接 id 重复：${connection.id}`);
    ids.add(connection.id);
  }
}
