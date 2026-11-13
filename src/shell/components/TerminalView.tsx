import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { attachSession } from '../session-stream.ts';
import { registerTerminal } from '../debug-bridge.ts';

// 与 tokens.css 保持一致：xterm 只认具体值，不认 CSS 变量。
const THEME = {
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
};

const FONT_FAMILY = '"SFMono-Regular", Menlo, Monaco, "Courier New", monospace';

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
}

export function TerminalView({ sessionId, active }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.32,
      cursorBlink: true,
      allowProposedApi: true,
      theme: THEME,
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (error) {
      // WebGL 不可用时 canvas 渲染器接管，功能不受影响。
      console.warn('[terminal] WebGL 不可用，回退 canvas', error);
    }

    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
    fit.fit();

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

  return <div className="terminal-host" data-session-id={sessionId} ref={hostRef} />;
}
