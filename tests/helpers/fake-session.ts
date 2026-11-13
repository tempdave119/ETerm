import type { ExitInfo, SessionPort } from '../../src/core/ports.ts';

export interface FakeSession extends SessionPort {
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  closed: boolean;
  closeCount: number;
  emitData(data: string): void;
  emitExit(info: ExitInfo): void;
}

export function createFakeSession(): FakeSession {
  const dataHandlers = new Set<(data: string) => void>();
  const exitHandlers = new Set<(info: ExitInfo) => void>();

  const session: FakeSession = {
    writes: [],
    resizes: [],
    closed: false,
    closeCount: 0,
    write(data) {
      session.writes.push(data);
    },
    resize(cols, rows) {
      session.resizes.push({ cols, rows });
    },
    close() {
      session.closed = true;
      session.closeCount += 1;
    },
    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onExit(handler) {
      exitHandlers.add(handler);
      return () => exitHandlers.delete(handler);
    },
    emitData(data) {
      for (const handler of [...dataHandlers]) handler(data);
    },
    emitExit(info) {
      for (const handler of [...exitHandlers]) handler(info);
    },
  };

  return session;
}
