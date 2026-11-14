import type { PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { RightClickAction } from '../../shared/ipc.ts';
import type { LayoutNode, SplitNode } from '../layout.ts';
import { TerminalView, type TerminalHandle, type TerminalTheme } from './TerminalView.tsx';

interface PaneLayoutProps {
  node: LayoutNode;
  activePaneId: string;
  tabActive: boolean;
  showHeaders: boolean;
  fontSize: number;
  theme: TerminalTheme;
  rightClick: RightClickAction;
  rightClickCopySelection: boolean;
  onActivate(paneId: string): void;
  onClose(paneId: string): void;
  onResize(splitId: string, ratio: number): void;
  onResizeEnd(splitId: string, ratio: number): void;
  /** 终端的复制 / 粘贴 / 全选句柄按 pane 登记，菜单编辑动作作用于活动 pane。 */
  onTerminalReady(paneId: string, handle: TerminalHandle | null): void;
}

export function PaneLayout({
  node,
  activePaneId,
  tabActive,
  showHeaders,
  fontSize,
  theme,
  rightClick,
  rightClickCopySelection,
  onActivate,
  onClose,
  onResize,
  onResizeEnd,
  onTerminalReady,
}: PaneLayoutProps) {
  if (node.type === 'leaf') {
    const active = node.paneId === activePaneId;
    return (
      <section
        className="pane-node"
        data-active={active}
        data-pane-id={node.paneId}
        onMouseDown={() => onActivate(node.paneId)}
      >
        {showHeaders ? (
          <header className="pane-node__header">
            <span className="pane-node__title">{node.title}</span>
            <button
              className="icon-button"
              type="button"
              title="关闭窗格"
              aria-label="关闭窗格"
              data-testid={`pane-close-${node.paneId}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(node.paneId);
              }}
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </header>
        ) : null}
        <div className="pane-node__body">
          <TerminalView
            sessionId={node.sessionId}
            active={active && tabActive}
            fontSize={fontSize}
            theme={theme}
            rightClick={rightClick}
            rightClickCopySelection={rightClickCopySelection}
            onReady={(handle) => onTerminalReady(node.paneId, handle)}
          />
        </div>
      </section>
    );
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, split: SplitNode): void => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = split.direction === 'row' ? 'col-resize' : 'row-resize';
    let lastRatio = split.ratio;

    const move = (moveEvent: PointerEvent): void => {
      const ratio =
        split.direction === 'row'
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      lastRatio = ratio;
      onResize(split.id, ratio);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.cursor = previousCursor;
      // 拖动过程只改内存，松手才落盘；最后一个比例由这里显式交回，避免帧未刷新时写成旧值。
      onResizeEnd(split.id, lastRatio);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className={node.direction === 'row' ? 'split split--row' : 'split split--column'}>
      <div className="split__child" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <PaneLayout
          node={node.first}
          activePaneId={activePaneId}
          tabActive={tabActive}
          showHeaders={showHeaders}
          fontSize={fontSize}
          theme={theme}
          rightClick={rightClick}
          rightClickCopySelection={rightClickCopySelection}
          onActivate={onActivate}
          onClose={onClose}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
          onTerminalReady={onTerminalReady}
        />
      </div>
      <div
        className="split__divider"
        role="separator"
        aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
        data-testid={`split-divider-${node.id}`}
        onPointerDown={(event) => startResize(event, node)}
      />
      <div className="split__child" style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <PaneLayout
          node={node.second}
          activePaneId={activePaneId}
          tabActive={tabActive}
          showHeaders={showHeaders}
          fontSize={fontSize}
          theme={theme}
          rightClick={rightClick}
          rightClickCopySelection={rightClickCopySelection}
          onActivate={onActivate}
          onClose={onClose}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
          onTerminalReady={onTerminalReady}
        />
      </div>
    </div>
  );
}
