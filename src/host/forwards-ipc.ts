import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { SessionService } from '../core/session-service.ts';
import { FORWARDS_IPC, type ForwardRequest, type ForwardView, type IpcResult } from '../shared/ipc.ts';
import { requireSessionPort } from './session-capability.ts';
import { readInteger, readRecord, readString } from './validate.ts';

const SESSION_ID_MAX = 64;
const HOST_MAX = 255;
const ID_MAX = 64;

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

function readForwardRequest(raw: unknown): ForwardRequest {
  const value = readRecord(raw, '转发参数');
  const direction = value.direction;
  if (direction !== 'local' && direction !== 'remote') throw new Error('转发方向必须是 local 或 remote');
  return {
    direction,
    bindHost: readString(value.bindHost, '监听地址', HOST_MAX),
    bindPort: readInteger(value.bindPort, '监听端口', 0, 65535),
    targetHost: readString(value.targetHost, '目标主机', HOST_MAX),
    targetPort: readInteger(value.targetPort, '目标端口', 1, 65535),
  };
}

/** 端口转发挂在会话上：会话没了，监听与通道一起释放。 */
export function registerForwardsIpc(
  sessions: Pick<SessionService, 'forwardPort' | 'has'>,
): () => void {
  const portOf = (sessionId: string) =>
    requireSessionPort(sessions.forwardPort(sessionId), {
      sessionId,
      sessionAlive: sessions.has(sessionId),
      capability: 'forward',
    });

  ipcMain.handle(FORWARDS_IPC.list, (_event, rawSessionId): IpcResult<ForwardView[]> => {
    try {
      const sessionId = readString(rawSessionId, 'sessionId', SESSION_ID_MAX);
      return { ok: true, value: portOf(sessionId).list() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FORWARDS_IPC.open, async (_event, raw): Promise<IpcResult<ForwardView>> => {
    try {
      const value = readRecord(raw, '转发参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      const request = readForwardRequest(value.request);
      return { ok: true, value: await portOf(sessionId).open(request) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(FORWARDS_IPC.close, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      const value = readRecord(raw, '转发参数');
      const sessionId = readString(value.sessionId, 'sessionId', SESSION_ID_MAX);
      await portOf(sessionId).close(readString(value.id, '转发 id', ID_MAX));
      return { ok: true, value: null };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    for (const channel of [FORWARDS_IPC.list, FORWARDS_IPC.open, FORWARDS_IPC.close]) {
      ipcMain.removeHandler(channel);
    }
  };
}
