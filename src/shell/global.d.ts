import type { EtermApi } from '../shared/ipc.ts';

interface TerminalDebugApi {
  list(): string[];
  read(sessionId: string): string;
  size(sessionId: string): { cols: number; rows: number } | null;
  /** 单元格的像素尺寸，用于验证字号 / 行高是否真的作用到了渲染器。 */
  metrics(sessionId: string): { cellWidth: number; cellHeight: number } | null;
  /** 当前实际生效的终端外观选项。 */
  options(sessionId: string): {
    fontSize: number | undefined;
    fontFamily: string | undefined;
    lineHeight: number | undefined;
    cursorStyle: string | undefined;
    cursorBlink: boolean | undefined;
    scrollback: number | undefined;
  } | null;
  type(sessionId: string, data: string): boolean;
}

declare global {
  interface Window {
    eterm: EtermApi;
    __etermDebug?: TerminalDebugApi;
  }
}

export {};
