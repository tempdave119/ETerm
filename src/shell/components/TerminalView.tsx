import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { RightClickAction } from '../../shared/ipc.ts';
import {
  TERMINAL_FONT_STACKS,
  type TerminalCursorStyle,
  type TerminalFontFamily,
} from '../../shared/terminal-font.ts';
import { t } from '../../shared/i18n/index.ts';
import { attachSession } from '../session-stream.ts';
import { registerTerminal } from '../debug-bridge.ts';

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
  fontSize: number;
  fontFamily: TerminalFontFamily;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  /** 只在新建终端时生效。 */
  scrollback: number;
  theme: ITheme;
  rightClick: RightClickAction;
  rightClickCopySelection: boolean;
  /** 把复制 / 粘贴 / 全选句柄交给外壳，供应用菜单调用；卸载时传 null。 */
  onReady?(handle: TerminalHandle | null): void;
}

/** 应用菜单的编辑动作：终端是 canvas 渲染，只能通过实例方法操作选区。 */
export interface TerminalHandle {
  copy(): void;
  paste(): void;
  selectAll(): void;
  /** 打开终端内搜索条并聚焦输入框。 */
  find(): void;
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
  fontFamily,
  lineHeight,
  cursorStyle,
  cursorBlink,
  scrollback,
  theme,
  rightClick,
  rightClickCopySelection,
  onReady,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rightClickRef = useRef(rightClick);
  const copySelectionRef = useRef(rightClickCopySelection);
  // 用 ref 保存回调：onReady 变化不应该重建终端实例。
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    rightClickRef.current = rightClick;
    copySelectionRef.current = rightClickCopySelection;
    if (rightClick !== 'menu') setMenu(null);
  }, [rightClick, rightClickCopySelection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_STACKS[fontFamily],
      fontSize,
      lineHeight,
      cursorStyle,
      cursorBlink,
      scrollback,
      allowProposedApi: true,
      theme,
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    const search = new SearchAddon();
    searchRef.current = search;
    term.loadAddon(search);

    // 不加载 WebglAddon：xterm 6.0 的 WebGL 渲染器在本机把字形画成半透明细线，
    // 笔画发灰发虚；canvas 渲染器同字号下笔画实心、边缘干净。

    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
    fit.fit();

    onReadyRef.current?.({
      copy: () => copySelection(term),
      paste: () => pasteClipboard(term),
      selectAll: () => term.selectAll(),
      find: () => {
        setFindOpen(true);
        // 等浮层挂载后再聚焦，否则 ref 还没指向输入框。
        requestAnimationFrame(() => findInputRef.current?.focus());
      },
    });

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
        const line =
          info.reason === 'network'
            ? `\r\n\x1b[2m${t('terminal.disconnected')}\x1b[0m\r\n`
            : `\r\n\x1b[2m${t('terminal.exited', { code: info.code ?? t('terminal.unknownCode') })}\x1b[0m\r\n`;
        term.write(line);
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
      onReadyRef.current?.(null);
      observer.disconnect();
      inputSubscription.dispose();
      host.removeEventListener('contextmenu', onContextMenu);
      detach();
      detachDebug();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
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
    // 外观来自配置：改完立即作用到已开着的终端，再补一次尺寸同步。
    // scrollback 是构造期选项，不在 applyOptions 范围内，只有新终端会拿到新值。
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    term.options.fontFamily = TERMINAL_FONT_STACKS[fontFamily];
    term.options.lineHeight = lineHeight;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
    fit.fit();
    void window.eterm.resizeSession(sessionId, term.cols, term.rows);
    // 行高变更后 xterm 在下一帧才重算 cell 尺寸，紧接的 fit 会拿到旧值；补一帧再算。
    const frame = requestAnimationFrame(() => {
      if (!termRef.current || !fitRef.current) return;
      fitRef.current.fit();
      void window.eterm.resizeSession(sessionId, termRef.current.cols, termRef.current.rows);
    });
    return () => cancelAnimationFrame(frame);
  }, [fontSize, fontFamily, lineHeight, cursorStyle, cursorBlink, sessionId]);

  useEffect(() => {
    // 主题切换不重建终端，直接换调色板。
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme;
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

  const closeFind = (): void => {
    setFindOpen(false);
    setFindQuery('');
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <>
      <div className="terminal-host" data-session-id={sessionId} ref={hostRef} />
      {findOpen ? (
        <div className="terminal-find" data-testid="terminal-find">
          <input
            ref={findInputRef}
            data-testid="terminal-find-input"
            value={findQuery}
            placeholder={t('terminal.findPlaceholder')}
            onChange={(event) => {
              setFindQuery(event.target.value);
              // 边输边高亮；空串会清掉之前的匹配高亮。
              searchRef.current?.findNext(event.target.value, { incremental: true });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) searchRef.current?.findPrevious(findQuery);
                else searchRef.current?.findNext(findQuery);
                return;
              }
              if (event.key === 'Escape') {
                // 吃掉 Esc：不触发全局命令，也不传给终端。
                event.preventDefault();
                event.stopPropagation();
                closeFind();
              }
            }}
          />
          <button
            className="icon-button"
            type="button"
            title={t('terminal.findPrev')}
            aria-label={t('terminal.findPrev')}
            data-testid="terminal-find-prev"
            onClick={() => searchRef.current?.findPrevious(findQuery)}
          >
            <ChevronUp size={13} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('terminal.findNext')}
            aria-label={t('terminal.findNext')}
            data-testid="terminal-find-next"
            onClick={() => searchRef.current?.findNext(findQuery)}
          >
            <ChevronDown size={13} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('terminal.findClose')}
            aria-label={t('terminal.findClose')}
            data-testid="terminal-find-close"
            onClick={closeFind}
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
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
                {t('common.copy')}
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
                {t('common.paste')}
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
                {t('common.selectAll')}
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
                {t('terminal.clear')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
