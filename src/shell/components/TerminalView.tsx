import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { RightClickAction } from '../../shared/ipc.ts';
import { attachSession } from '../session-stream.ts';
import { registerTerminal } from '../debug-bridge.ts';

// xterm 只认具体值，不认 CSS 变量；两套调色板与 tokens.css 的深浅色保持同值。
export type TerminalTheme = 'dark' | 'light';

const TERMINAL_THEMES: Record<TerminalTheme, ITheme> = {
  dark: {
    background: '#16181c',
    foreground: '#e6e8eb',
    cursor: '#7aa2f7',
    selectionBackground: 'rgba(122, 162, 247, 0.28)',
    black: '#1b1e24',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#c0caf5',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#e6e8eb',
  },
  light: {
    background: '#f5f6f8',
    foreground: '#1c1f24',
    cursor: '#2b6cb0',
    selectionBackground: 'rgba(43, 108, 176, 0.2)',
    black: '#1c1f24',
    red: '#c93c52',
    green: '#3f7d20',
    yellow: '#9a6700',
    blue: '#2b6cb0',
    magenta: '#8b4aa0',
    cyan: '#0e7490',
    white: '#4d545d',
    brightBlack: '#737b86',
    brightRed: '#e05570',
    brightGreen: '#4f9a2a',
    brightYellow: '#b57d00',
    brightBlue: '#3b82c4',
    brightMagenta: '#a45cb8',
    brightCyan: '#1490a8',
    brightWhite: '#1c1f24',
  },
};

// SFMono-Regular 不是 macOS 可解析的 family 名（系统私有字体为 .SF NS Mono，Chromium 拒绝访问），
// 写进去只会被跳过；显式落到 Menlo，装了 SF Mono 的机器优先用它。
const FONT_FAMILY = '"SF Mono", Menlo, Monaco, "Courier New", monospace';

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
  fontSize: number;
  theme: TerminalTheme;
  rightClick: RightClickAction;
  rightClickCopySelection: boolean;
}

function copySelection(term: Terminal | null): void {
  if (!term || !term.hasSelection()) return;
  void window.eterm.writeClipboard(term.getSelection());
  term.clearSelection();
}

function pasteClipboard(term: Terminal | null): void {
  if (!term) return;
  void window.eterm.readClipboard().then((result) => {
    if (result.ok && result.value) term.paste(result.value);
  });
}

export function TerminalView({
  sessionId,
  active,
  fontSize,
  theme,
  rightClick,
  rightClickCopySelection,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rightClickRef = useRef(rightClick);
  const copySelectionRef = useRef(rightClickCopySelection);

  useEffect(() => {
    rightClickRef.current = rightClick;
    copySelectionRef.current = rightClickCopySelection;
    if (rightClick !== 'menu') setMenu(null);
  }, [rightClick, rightClickCopySelection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: TERMINAL_THEMES[theme],
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // 不加载 WebglAddon：xterm 6.0 的 WebGL 渲染器在本机把字形画成半透明细线，
    // 笔画发灰发虚；canvas 渲染器同字号下笔画实心、边缘干净。

    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
    fit.fit();

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const action = rightClickRef.current;
      if (action === 'off') return;
      if (action === 'paste') {
        if (copySelectionRef.current && term.hasSelection()) copySelection(term);
        else pasteClipboard(term);
        return;
      }
      setMenu({
        x: Math.min(event.clientX, Math.max(0, window.innerWidth - 160)),
        y: Math.min(event.clientY, Math.max(0, window.innerHeight - 160)),
      });
    };
    host.addEventListener('contextmenu', onContextMenu);

    // ⌘C / ⌘V 走主进程剪贴板；Ctrl+C 仍交给终端发 SIGINT。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.metaKey || event.altKey) return true;
      if (event.code === 'KeyC') {
        if (!term.hasSelection()) return true;
        copySelection(term);
        return false;
      }
      if (event.code === 'KeyV') {
        pasteClipboard(term);
        return false;
      }
      return true;
    });

    const detach = attachSession(sessionId, {
      onData: (data) => term.write(data),
      onExit: (info) => {
        term.write(`\r\n\x1b[2m[进程已退出，代码 ${info.code ?? '未知'}]\x1b[0m\r\n`);
      },
    });
    const detachDebug = registerTerminal(sessionId, term);

    const inputSubscription = term.onData((data) => {
      void window.eterm.writeSession(sessionId, data);
    });

    const observer = new ResizeObserver(() => {
      if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      void window.eterm.resizeSession(sessionId, term.cols, term.rows);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      inputSubscription.dispose();
      host.removeEventListener('contextmenu', onContextMenu);
      detach();
      detachDebug();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    // display:none 期间 fit 量不到尺寸，切回来时补一次。
    const frame = requestAnimationFrame(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      fit.fit();
      void window.eterm.resizeSession(sessionId, term.cols, term.rows);
      term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId]);

  useEffect(() => {
    // 字号来自配置：改完立即作用到已开着的终端，再补一次尺寸同步。
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    fit.fit();
    void window.eterm.resizeSession(sessionId, term.cols, term.rows);
  }, [fontSize, sessionId]);

  useEffect(() => {
    // 主题切换不重建终端，直接换调色板。
    const term = termRef.current;
    if (!term) return;
    term.options.theme = TERMINAL_THEMES[theme];
  }, [theme]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent): void => {
      if ((event.target as HTMLElement).closest('.terminal-menu')) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  return (
    <>
      <div className="terminal-host" data-session-id={sessionId} ref={hostRef} />
      {menu
        ? createPortal(
            <div
              className="terminal-menu"
              role="menu"
              data-testid="terminal-menu"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                className="terminal-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  copySelection(termRef.current);
                  setMenu(null);
                }}
              >
                复制
              </button>
              <button
                className="terminal-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  pasteClipboard(termRef.current);
                  setMenu(null);
                }}
              >
                粘贴
              </button>
              <button
                className="terminal-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  termRef.current?.selectAll();
                  setMenu(null);
                }}
              >
                全选
              </button>
              <button
                className="terminal-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  termRef.current?.clear();
                  setMenu(null);
                }}
              >
                清屏
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
