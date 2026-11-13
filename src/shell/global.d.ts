import type { EtermApi } from '../shared/ipc.ts';

interface TerminalDebugApi {
  read(sessionId: string): string;
  size(sessionId: string): { cols: number; rows: number } | null;
  type(sessionId: string, data: string): boolean;
}

declare global {
  interface Window {
    eterm: EtermApi;
    __etermDebug?: TerminalDebugApi;
  }
}

export {};
