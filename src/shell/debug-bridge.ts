import type { Terminal } from '@xterm/xterm';

/**
 * CDP 冒烟用的只读/输入桥：只有加载页带 ?debug 时才安装，正常运行不暴露。
 * 用 xterm 自己的 input() 与缓冲区，走的是和键盘一致的数据通路。
 */
const debugEnabled = new URLSearchParams(window.location.search).has('debug');
const terminals = new Map<string, Terminal>();
let installed = false;

export function registerTerminal(sessionId: string, terminal: Terminal): () => void {
  if (!debugEnabled) return () => {};

  terminals.set(sessionId, terminal);
  install();
  return () => {
    terminals.delete(sessionId);
  };
}

function install(): void {
  if (installed) return;
  installed = true;
  window.__etermDebug = {
    list: () => [...terminals.keys()],
    read: (sessionId) => dump(terminals.get(sessionId)),
    size: (sessionId) => {
      const terminal = terminals.get(sessionId);
      return terminal ? { cols: terminal.cols, rows: terminal.rows } : null;
    },
    metrics: (sessionId) => {
      const terminal = terminals.get(sessionId);
      // xterm 没有公开 cell 尺寸，冒烟只能读内部 renderService（仅 ?debug 安装）。
      const core = (terminal as unknown as {
        _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
      })?._core;
      const cell = core?._renderService?.dimensions?.css?.cell;
      return cell?.width && cell?.height ? { cellWidth: cell.width, cellHeight: cell.height } : null;
    },
    options: (sessionId) => {
      const terminal = terminals.get(sessionId);
      if (!terminal) return null;
      const options = terminal.options;
      return {
        fontSize: options.fontSize,
        fontFamily: options.fontFamily,
        lineHeight: options.lineHeight,
        cursorStyle: options.cursorStyle,
        cursorBlink: options.cursorBlink,
        scrollback: options.scrollback,
      };
    },
    lines: (sessionId) => {
      const terminal = terminals.get(sessionId);
      if (!terminal) return [];
      const buffer = terminal.buffer.active;
      const out: { text: string; wrapped: boolean }[] = [];
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        out.push({ text: line?.translateToString(true) ?? '', wrapped: line?.isWrapped ?? false });
      }
      return out;
    },
    type: (sessionId, data) => {
      const terminal = terminals.get(sessionId);
      if (!terminal) return false;
      terminal.input(data);
      return true;
    },
  };
}

function dump(terminal?: Terminal): string {
  if (!terminal) return '';
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
  }
  return lines.join('\n').trimEnd();
}
