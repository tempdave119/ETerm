import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { CredentialStore, SecretKind } from '../services/credentials/store.ts';
import { CREDENTIALS_IPC, type IpcResult } from '../shared/ipc.ts';
import { readRecord, readString } from './validate.ts';

const ID_MAX = 64;
const SECRET_MAX = 4096;

function readKind(raw: unknown): SecretKind {
  if (raw === 'password' || raw === 'passphrase') return raw;
  throw new Error('凭据类型无效');
}

/** 密码只在保存连接时从渲染层传一次；main 加密落盘，读取永远走 connection:open。 */
export function registerCredentialsIpc(store: Pick<CredentialStore, 'set' | 'has'>): () => void {
  ipcMain.handle(CREDENTIALS_IPC.set, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const value = readRecord(raw, '凭据参数');
      await store.set(
        readString(value.connectionId, 'connectionId', ID_MAX),
        readKind(value.kind),
        readString(value.secret, '凭据', SECRET_MAX),
      );
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  ipcMain.handle(CREDENTIALS_IPC.has, async (_event, raw): Promise<IpcResult<boolean>> => {
    try {
      const value = readRecord(raw, '凭据参数');
      return {
        ok: true,
        value: await store.has(
          readString(value.connectionId, 'connectionId', ID_MAX),
          readKind(value.kind),
        ),
      };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => {
    ipcMain.removeHandler(CREDENTIALS_IPC.set);
    ipcMain.removeHandler(CREDENTIALS_IPC.has);
  };
}
