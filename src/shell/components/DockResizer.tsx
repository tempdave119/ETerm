import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DOCK_SIZE_LIMITS } from '../../shared/panels.ts';

export type HorizontalDock = 'left' | 'right';

interface DockResizerProps {
  side: HorizontalDock;
  width: number;
  /** 另一侧停靠区宽度；未渲染时为 0。 */
  otherWidth: number;
  onResize(width: number): void;
  onResizeEnd(width: number): void;
}

/** 工作区最小宽度，避免两侧都拖到最大后终端被挤没。 */
const WORKSPACE_MIN = 320;
/** 两根 5px 分隔条的总宽度。 */
const RESIZER_TOTAL = 10;

export function dockSizeMax(side: HorizontalDock, otherWidth: number): number {
  const limit = DOCK_SIZE_LIMITS[side];
  const available = window.innerWidth - otherWidth - WORKSPACE_MIN - RESIZER_TOTAL;
  return Math.max(limit.min, Math.min(limit.max, Math.floor(available)));
}

/**
 * 左右停靠区的宽度拖拽条：拖动时只改内存，松手才落盘。
 * 上限同时受固定边界与「工作区至少 WORKSPACE_MIN」约束。
 */
export function DockResizer({ side, width, otherWidth, onResize, onResizeEnd }: DockResizerProps) {
  const frameRef = useRef<number | null>(null);
  const pendingWidth = useRef(width);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const limit = DOCK_SIZE_LIMITS[side];
    const max = dockSizeMax(side, otherWidth);
    pendingWidth.current = width;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';

    const move = (moveEvent: PointerEvent): void => {
      const delta = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      pendingWidth.current = Math.min(max, Math.max(limit.min, startWidth + delta));
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        onResize(pendingWidth.current);
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
      onResizeEnd(pendingWidth.current);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div
      className={`dock-resizer dock-resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      aria-valuemin={DOCK_SIZE_LIMITS[side].min}
      aria-valuemax={dockSizeMax(side, otherWidth)}
      aria-valuenow={width}
      tabIndex={0}
      title="拖动或方向键调整宽度"
      data-testid={`dock-resizer-${side}`}
      onPointerDown={startResize}
      onKeyDown={(event) => resizeWithKeyboard(event, side, width, otherWidth, onResizeEnd)}
    />
  );
}

function resizeWithKeyboard(
  event: ReactKeyboardEvent<HTMLDivElement>,
  side: HorizontalDock,
  width: number,
  otherWidth: number,
  onResize: (width: number) => void,
): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const limit = DOCK_SIZE_LIMITS[side];
  const direction = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
  const next = Math.min(dockSizeMax(side, otherWidth), Math.max(limit.min, width + direction * 10));
  onResize(next);
}
