import type { ExitInfo } from '../core/ports.ts';

type DataHandler = (data: string) => void;
type ExitHandler = (info: ExitInfo) => void;

const MAX_BUFFERED_CHARS = 64 * 1024;
const MAX_TRACKED_SESSIONS = 64;

const buffers = new Map<string, string>();
const pendingExits = new Map<string, ExitInfo>();
const dataHandlers = new Map<string, Set<DataHandler>>();
const exitHandlers = new Map<string, Set<ExitHandler>>();
let started = false;

/** 会话关掉后没人来取缓冲与退出信息，这里按先进先出封顶，避免长跑进程无限增长。 */
function remember<V>(map: Map<string, V>, sessionId: string, value: V): void {
  map.delete(sessionId);
  map.set(sessionId, value);
  if (map.size > MAX_TRACKED_SESSIONS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * 单一数据泵：先订阅、后挂载。标签从 open 到 TerminalView 挂上之间会有一小段空窗，
 * 这段时间的输出必须缓冲，否则新标签的第一屏 prompt 会丢。
 */
function ensureStarted(): void {
  if (started) return;
  const api = window.eterm;
  if (!api) return;
  started = true;

  api.onSessionData((sessionId, data) => {
    const handlers = dataHandlers.get(sessionId);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) handler(data);
      return;
    }
    remember(buffers, sessionId, ((buffers.get(sessionId) ?? '') + data).slice(-MAX_BUFFERED_CHARS));
  });

  api.onSessionExit((sessionId, info) => {
    const handlers = exitHandlers.get(sessionId);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) handler(info);
      return;
    }
    remember(pendingExits, sessionId, info);
  });
}

export function startSessionStream(): void {
  ensureStarted();
}

export function attachSession(
  sessionId: string,
  handlers: { onData: DataHandler; onExit: ExitHandler },
): () => void {
  ensureStarted();

  const data = dataHandlers.get(sessionId) ?? new Set<DataHandler>();
  data.add(handlers.onData);
  dataHandlers.set(sessionId, data);

  const exit = exitHandlers.get(sessionId) ?? new Set<ExitHandler>();
  exit.add(handlers.onExit);
  exitHandlers.set(sessionId, exit);

  const buffered = buffers.get(sessionId);
  if (buffered) {
    buffers.delete(sessionId);
    handlers.onData(buffered);
  }

  const exited = pendingExits.get(sessionId);
  if (exited) {
    pendingExits.delete(sessionId);
    handlers.onExit(exited);
  }

  return () => {
    data.delete(handlers.onData);
    if (data.size === 0) dataHandlers.delete(sessionId);

    exit.delete(handlers.onExit);
    if (exit.size === 0) exitHandlers.delete(sessionId);
  };
}
