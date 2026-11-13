import { X } from 'lucide-react';
import type { LayoutNode } from '../layout.ts';
import { TerminalView } from './TerminalView.tsx';

interface PaneLayoutProps {
  node: LayoutNode;
  activePaneId: string;
  tabActive: boolean;
  showHeaders: boolean;
  onActivate(paneId: string): void;
  onClose(paneId: string): void;
}

export function PaneLayout({
  node,
  activePaneId,
  tabActive,
  showHeaders,
  onActivate,
  onClose,
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
          <TerminalView sessionId={node.sessionId} active={active && tabActive} />
        </div>
      </section>
    );
  }

  return (
    <div className={node.direction === 'row' ? 'split split--row' : 'split split--column'}>
      <div className="split__child" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <PaneLayout
          node={node.first}
          activePaneId={activePaneId}
          tabActive={tabActive}
          showHeaders={showHeaders}
          onActivate={onActivate}
          onClose={onClose}
        />
      </div>
      <div className="split__divider" />
      <div className="split__child" style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <PaneLayout
          node={node.second}
          activePaneId={activePaneId}
          tabActive={tabActive}
          showHeaders={showHeaders}
          onActivate={onActivate}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
