import { Fragment, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { DockId } from '../../shared/panels.ts';
import type { PanelDefinition } from '../panels/registry.ts';

interface DockPanelItem {
  definition: PanelDefinition;
  node: ReactNode;
}

interface DockColumnProps {
  dock: DockId;
  /** 左右停靠区的宽度（px）；底栏不传。 */
  size?: number;
  panels: DockPanelItem[];
  /** 区内分隔的累计比例，长度 = 面板数 - 1。 */
  dividers: number[];
  onResize(index: number, ratio: number): void;
  onResizeEnd(index: number, ratio: number): void;
}

/**
 * 一个停靠区：面板自上而下排列，面板之间的分隔条可拖动改比例。
 * 区内尺寸用累计比例换算成 flexGrow，窗口缩放时比例保持不变。
 */
export function DockColumn({ dock, size, panels, dividers, onResize, onResizeEnd }: DockColumnProps) {
  // 拖动时每帧只提交一次比例，避免 pointermove 高频触发整棵面板树重渲染。
  const frameRef = useRef<number | null>(null);
  const pendingRatio = useRef(0);

  if (panels.length === 0) return null;

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, index: number): void => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.height === 0) return;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'row-resize';
    let lastRatio = dividers[index] ?? 0.5;

    const move = (moveEvent: PointerEvent): void => {
      lastRatio = (moveEvent.clientY - rect.top) / rect.height;
      pendingRatio.current = lastRatio;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        onResize(index, pendingRatio.current);
      });
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      // 拖动过程只改内存，松手才落盘；显式交回最后一个比例，避免帧未刷新时写成旧值。
      onResizeEnd(index, lastRatio);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div
      className={`dock dock--${dock}`}
      data-testid={`dock-${dock}`}
      style={size ? { flex: `0 0 ${size}px`, width: `${size}px` } : undefined}
    >
      {panels.map((panel, index) => {
        const start = index === 0 ? 0 : (dividers[index - 1] ?? index / panels.length);
        const end =
          index === panels.length - 1 ? 1 : (dividers[index] ?? (index + 1) / panels.length);
        return (
          <Fragment key={panel.definition.id}>
            <div
              className="dock__item"
              data-panel-id={panel.definition.id}
              style={{ flexGrow: Math.max(end - start, 0.05), flexBasis: 0 }}
            >
              {panel.node}
            </div>
            {index < panels.length - 1 ? (
              <div
                className="dock__divider"
                role="separator"
                aria-orientation="horizontal"
                data-testid={`dock-divider-${dock}-${index}`}
                onPointerDown={(event) => startResize(event, index)}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
