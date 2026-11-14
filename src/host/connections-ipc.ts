import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { ConnectionStore } from '../services/connections/store.ts';
import type { CredentialStore } from '../services/credentials/store.ts';
import {
  CONNECTIONS_IPC,
  type ConnectionInput,
  type ConnectionRecord,
  type ConnectionsSnapshot,
  type GroupInput,
  type GroupRecord,
  type IpcResult,
} from '../shared/ipc.ts';
import { readInteger, readOptionalInteger, readOptionalString, readRecord, readString } from './validate.ts';

const ID_MAX = 64;
const NAME_MAX = 120;
const NOTE_MAX = 200;
const HOST_MAX = 255;
const USER_MAX = 255;
const PATH_MAX = 4096;

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readAuth(raw: unknown): ConnectionInput['auth'] {
  if (raw === undefined || raw === null) return undefined;
  if (raw === 'password' || raw === 'key' || raw === 'agent' || raw === 'none') return raw;
  throw new Error('认证方式无效');
}

function readOptions(raw: unknown): ConnectionInput['options'] {
  if (raw === undefined || raw === null) return raw;
  const value = readRecord(raw, '组件字段');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error('组件字段最多 32 项');
  return Object.fromEntries(entries.map(([key, item]) => [key, readString(item, `组件字段 ${key}`, 4096)]));
}

function readProxy(raw: unknown): ConnectionInput['proxy'] {
  if (raw === undefined || raw === null) return raw;
  const value = readRecord(raw, '代理参数');
  if (value.type !== 'http' && value.type !== 'socks5') throw new Error('代理类型无效');
  return {
    type: value.type,
    host: readString(value.host, '代理主机', HOST_MAX),
    port: readInteger(value.port, '代理端口', 1, 65535),
    username: readOptionalString(value.username, '代理用户名', USER_MAX),
  };
}

function readConnectionInput(raw: unknown): ConnectionInput {
  const value = readRecord(raw, '连接参数');
  return {
    id: readOptionalString(value.id, '连接 id', ID_MAX),
    name: readString(value.name, '连接名称', NAME_MAX),
    protocol: readString(value.protocol, '连接协议', 32),
    host: readOptionalString(value.host, '主机', HOST_MAX),
    port: readOptionalInteger(value.port, '端口', 1, 65535),
    username: readOptionalString(value.username, '用户名', USER_MAX),
    auth: readAuth(value.auth),
    groupId: value.groupId === null ? null : readOptionalString(value.groupId, '分组', ID_MAX),
    keyPath: readOptionalString(value.keyPath, '私钥路径', PATH_MAX),
    jumpConnectionId:
      value.jumpConnectionId === null ? null : readOptionalString(value.jumpConnectionId, '跳板机', ID_MAX),
    proxy: readProxy(value.proxy),
    options: readOptions(value.options),
    note: readOptionalString(value.note, '备注', NOTE_MAX),
  };
}

function readGroupInput(raw: unknown): GroupInput {
  const value = readRecord(raw, '分组参数');
  return {
    id: readOptionalString(value.id, '分组 id', ID_MAX),
    name: readString(value.name, '分组名称', NAME_MAX),
  };
}

export function registerConnectionsIpc(
  store: ConnectionStore,
  credentials: Pick<CredentialStore, 'removeAll'>,
): () => void {
  ipcMain.handle(CONNECTIONS_IPC.list, async (): Promise<IpcResult<ConnectionsSnapshot>> => {
    try {
      return success(await store.list());
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    CONNECTIONS_IPC.saveConnection,
    async (_event, raw): Promise<IpcResult<ConnectionRecord>> => {
      try {
        return success(await store.saveConnection(readConnectionInput(raw)));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(CONNECTIONS_IPC.deleteConnection, async (_event, rawId): Promise<IpcResult<null>> => {
    try {
      const id = readString(rawId, '连接 id', ID_MAX);
      await store.deleteConnection(id);
      // 连接删掉后凭据一并清理，避免 Keychain 里留下孤儿密文。
      await credentials.removeAll(id);
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(CONNECTIONS_IPC.reorder, async (_event, rawIds): Promise<IpcResult<null>> => {
    try {
      if (!Array.isArray(rawIds) || rawIds.length > 1000) throw new Error('排序参数必须是数组');
      const ids = rawIds.map((id, index) => readString(id, `排序 id #${index + 1}`, ID_MAX));
      await store.reorderConnections(ids);
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(CONNECTIONS_IPC.saveGroup, async (_event, raw): Promise<IpcResult<GroupRecord>> => {
    try {
      return success(await store.saveGroup(readGroupInput(raw)));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(CONNECTIONS_IPC.deleteGroup, async (_event, rawId): Promise<IpcResult<null>> => {
    try {
      await store.deleteGroup(readString(rawId, '分组 id', ID_MAX));
      return success(null);
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of Object.values(CONNECTIONS_IPC)) ipcMain.removeHandler(channel);
  };
}
