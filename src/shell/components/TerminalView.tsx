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
  showLineNumbers: boolean;
  showTimestamps: boolean;
  theme: ITheme;
  rightClick: RightClickAction;
  rightClickCopySelection: boolean;
  /** 把复制 / 粘贴 / 全选句柄交给外壳，供应用菜单调用；卸载时传 null。 */
  onReady?(handle: TerminalHandle | null): void;
}

interface GutterRow {
  /** 绝对行号，同时作为 React key。 */
  key: number;
  /** 该行首次输出的时刻；折行或空行为 null。 */
  time: number | null;
  /** 行号；空行不显示行号。 */
  line: number | null;
}

function formatClock(epoch: number): string {
  const date = new Date(epoch);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 单元格高度：用 xterm 可视区高度除以行数，随字号 / 行高自动变化。 */
function measureCellHeight(term: Terminal): number {
  const screen = term.element?.querySelector('.xterm-screen') as HTMLElement | null;
  if (!screen || term.rows <= 0) return 0;
  const height = screen.getBoundingClientRect().height / term.rows;
  return Number.isFinite(height) ? height : 0;
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
  showLineNumbers,
  showTimestamps,
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
  const [gutterRows, setGutterRows] = useState<GutterRow[]>([]);
  const [cellHeight, setCellHeight] = useState(0);
  // 累计逻辑行（按数据流换行计数）与每行首次输出时刻；缓冲满后旧行被顶掉，
  // 用「累计行数 - 当前缓冲行数」反推缓冲第 0 行的绝对行号，行号才能持续递增。
  const writtenRowsRef = useRef(0);
  const rowTimesRef = useRef(new Map<number, number>([[0, Date.now()]]));
  const gutterFrameRef = useRef<number | null>(null);
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

  const syncGutter = (): void => {
    const term = termRef.current;
    if (!term) return;
    const buffer = term.buffer.active;
    // 全屏应用（vim / top）没有行号意义，直接清空。
    if (buffer.type === 'alternate') {
      setGutterRows((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const absoluteTop = Math.max(0, writtenRowsRef.current - buffer.length + 1);
    const rows: GutterRow[] = [];
    for (let i = 0; i < term.rows; i += 1) {
      const row = buffer.viewportY + i;
      if (row >= buffer.length) break;
      const abs = absoluteTop + row;
      const line = buffer.getLine(row);
      // 空行不显示行号与时间，只保留占位高度，保证与终端逐行对齐。
      const hasContent = Boolean(line?.translateToString(true));
      rows.push({
        key: abs,
        time: !hasContent || line?.isWrapped ? null : (rowTimesRef.current.get(abs) ?? null),
        line: hasContent ? abs + 1 : null,
      });
    }
    setGutterRows((prev) => {
      if (
        prev.length === rows.length &&
        prev.every((item, index) => item.key === rows[index]?.key && item.time === rows[index]?.time)
      ) {
        return prev;
      }
      return rows;
    });
  };

  const scheduleGutterSync = (): void => {
    if (gutterFrameRef.current !== null) return;
    gutterFrameRef.current = requestAnimationFrame(() => {
      gutterFrameRef.current = null;
      syncGutter();
    });
  };

  const recordRows = (data: string): void => {
    const newlines = (data.match(/\n/g) ?? []).length;
    if (newlines === 0) return;
    const now = Date.now();
    const start = writtenRowsRef.current + 1;
    writtenRowsRef.current += newlines;
    for (let index = 0; index < newlines; index += 1) {
      rowTimesRef.current.set(start + index, now);
    }
    // 时间表只服务当前滚回范围，超出后从最早的行开始丢。
    if (rowTimesRef.current.size > 20000) {
      for (const key of rowTimesRef.current.keys()) {
        if (rowTimesRef.current.size <= 10000) break;
        rowTimesRef.current.delete(key);
      }
    }
    scheduleGutterSync();
  };

  const clearTerminal = (): void => {
    termRef.current?.clear();
    writtenRowsRef.current = 0;
    rowTimesRef.current = new Map([[0, Date.now()]]);
    scheduleGutterSync();
  };

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
    setCellHeight(measureCellHeight(term));
    scheduleGutterSync();

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
      onData: (data) => {
        recordRows(data);
        // 写入解析完成后再同步一次：否则最后一行（提示符）刚进缓冲区时 gutter 已经跑完，会缺行号。
        term.write(data, () => scheduleGutterSync());
      },
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
      setCellHeight(measureCellHeight(term));
      scheduleGutterSync();
      void window.eterm.resizeSession(sessionId, term.cols, term.rows);
    });
    observer.observe(host);

    // 以渲染帧为准同步 gutter：onScroll / 写入回调当时 viewportY 可能还没跟上屏幕，
    // 读到旧视口会把行号对到错误的缓冲区行（表现为偶发空白行）。
    const renderSubscription = term.onRender(() => scheduleGutterSync());

    return () => {
      onReadyRef.current?.(null);
      observer.disconnect();
      renderSubscription.dispose();
      inputSubscription.dispose();
      if (gutterFrameRef.current !== null) {
        cancelAnimationFrame(gutterFrameRef.current);
        gutterFrameRef.current = null;
      }
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
      setCellHeight(measureCellHeight(term));
      scheduleGutterSync();
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
      setCellHeight(measureCellHeight(termRef.current));
      scheduleGutterSync();
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
      <div className="terminal-shell">
        {showLineNumbers || showTimestamps ? (
          <div
            className="terminal-gutter"
            data-testid="terminal-gutter"
            style={{
              background: theme.background,
              color: theme.foreground ? `${theme.foreground}99` : undefined,
              fontFamily: TERMINAL_FONT_STACKS[fontFamily],
              fontSize,
            }}
          >
            {gutterRows.map((row) => (
              <div
                className="terminal-gutter__row"
                key={row.key}
                style={{ height: cellHeight > 0 ? cellHeight : undefined }}
              >
                {showTimestamps ? (
                  <span className="terminal-gutter__time">{row.time ? `[${formatClock(row.time)}]` : ''}</span>
                ) : null}
                {showLineNumbers && row.line !== null ? (
                  <span className="terminal-gutter__num">{row.line}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="terminal-host" data-session-id={sessionId} ref={hostRef} />
      </div>
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
                  clearTerminal();
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
