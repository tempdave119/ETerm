import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { KnownHostsStore } from '../services/known-hosts/store.ts';
import { KNOWN_HOSTS_IPC, type IpcResult } from '../shared/ipc.ts';
import { readInteger, readRecord, readString } from './validate.ts';

const HOST_MAX = 255;
const FINGERPRINT_MAX = 128;

/** 首次连接确认后由渲染层调用；只记指纹，不碰凭据。 */
export function registerKnownHostsIpc(store: Pick<KnownHostsStore, 'remember'>): () => void {
  ipcMain.handle(KNOWN_HOSTS_IPC.remember, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const value = readRecord(raw, '主机指纹参数');
      await store.remember(
        readString(value.host, 'host', HOST_MAX),
        readInteger(value.port, 'port', 1, 65535),
        readString(value.fingerprint, 'fingerprint', FINGERPRINT_MAX),
      );
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => ipcMain.removeHandler(KNOWN_HOSTS_IPC.remember);
}
