import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { ConnectionStore } from '../services/connections/store.ts';
import {
  CONNECTIONS_IPC,
  type ConnectionInput,
  type ConnectionRecord,
  type ConnectionsSnapshot,
  type GroupInput,
  type GroupRecord,
  type IpcResult,
} from '../shared/ipc.ts';
import { readOptionalInteger, readOptionalString, readRecord, readString } from './validate.ts';

const ID_MAX = 64;
const NAME_MAX = 120;
const HOST_MAX = 255;
const USER_MAX = 255;
const PATH_MAX = 4096;

function success<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readProtocol(raw: unknown): 'ssh' | 'local' {
  if (raw === 'ssh' || raw === 'local') return raw;
  throw new Error('连接协议必须是 ssh 或 local');
}

function readAuth(raw: unknown): ConnectionInput['auth'] {
  if (raw === undefined || raw === null) return undefined;
  if (raw === 'password' || raw === 'key' || raw === 'agent' || raw === 'none') return raw;
  throw new Error('认证方式无效');
}

function readConnectionInput(raw: unknown): ConnectionInput {
  const value = readRecord(raw, '连接参数');
  return {
    id: readOptionalString(value.id, '连接 id', ID_MAX),
    name: readString(value.name, '连接名称', NAME_MAX),
    protocol: readProtocol(value.protocol),
    host: readOptionalString(value.host, '主机', HOST_MAX),
    port: readOptionalInteger(value.port, '端口', 1, 65535),
    username: readOptionalString(value.username, '用户名', USER_MAX),
    auth: readAuth(value.auth),
    groupId: value.groupId === null ? null : readOptionalString(value.groupId, '分组', ID_MAX),
    keyPath: readOptionalString(value.keyPath, '私钥路径', PATH_MAX),
  };
}

function readGroupInput(raw: unknown): GroupInput {
  const value = readRecord(raw, '分组参数');
  return {
    id: readOptionalString(value.id, '分组 id', ID_MAX),
    name: readString(value.name, '分组名称', NAME_MAX),
  };
}

export function registerConnectionsIpc(store: ConnectionStore): () => void {
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
      await store.deleteConnection(readString(rawId, '连接 id', ID_MAX));
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
