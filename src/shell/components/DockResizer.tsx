import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DOCK_SIZE_LIMITS } from '../../shared/panels.ts';

export type DockResizeSide = 'left' | 'right' | 'bottom';

interface DockResizerProps {
  side: DockResizeSide;
  /** 当前宽度（左右栏）或高度（底栏）。 */
  size: number;
  /** 另一侧停靠区宽度；底栏忽略。未渲染时为 0。 */
  otherSize: number;
  onResize(size: number): void;
  onResizeEnd(size: number): void;
}

/** 工作区最小宽度，避免两侧都拖到最大后终端被挤没。 */
const WORKSPACE_MIN_WIDTH = 320;
/** 两根 5px 分隔条的总宽度。 */
const RESIZER_TOTAL = 10;

export function dockSizeMax(side: DockResizeSide, otherSize: number): number {
  const limit = DOCK_SIZE_LIMITS[side];
  if (side === 'bottom') return limit.max;
  const available = window.innerWidth - otherSize - WORKSPACE_MIN_WIDTH - RESIZER_TOTAL;
  return Math.max(limit.min, Math.min(limit.max, Math.floor(available)));
}

/**
 * 停靠区尺寸拖拽条：左右栏拖宽度，底栏拖高度。
 * 拖动时只改内存，松手才落盘；左右栏上限同时受固定边界与工作区最小宽度约束。
 */
export function DockResizer({ side, size, otherSize, onResize, onResizeEnd }: DockResizerProps) {
  const frameRef = useRef<number | null>(null);
  const pendingSize = useRef(size);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = size;
    const limit = DOCK_SIZE_LIMITS[side];
    const max = dockSizeMax(side, otherSize);
    pendingSize.current = size;

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = side === 'bottom' ? 'row-resize' : 'col-resize';

    const move = (moveEvent: PointerEvent): void => {
      const delta =
        side === 'left'
          ? moveEvent.clientX - startX
          : side === 'right'
            ? startX - moveEvent.clientX
            : startY - moveEvent.clientY;
      pendingSize.current = Math.min(max, Math.max(limit.min, startSize + delta));
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        onResize(pendingSize.current);
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
      onResizeEnd(pendingSize.current);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div
      className={`dock-resizer dock-resizer--${side}`}
      role="separator"
      aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'}
      aria-label={
        side === 'left' ? '调整左侧栏宽度' : side === 'right' ? '调整右侧栏宽度' : '调整底栏高度'
      }
      aria-valuemin={DOCK_SIZE_LIMITS[side].min}
      aria-valuemax={dockSizeMax(side, otherSize)}
      aria-valuenow={size}
      tabIndex={0}
      title={side === 'bottom' ? '拖动或方向键调整高度' : '拖动或方向键调整宽度'}
      data-testid={`dock-resizer-${side}`}
      onPointerDown={startResize}
      onKeyDown={(event) => resizeWithKeyboard(event, side, size, otherSize, onResizeEnd)}
    />
  );
}

function resizeWithKeyboard(
  event: ReactKeyboardEvent<HTMLDivElement>,
  side: DockResizeSide,
  size: number,
  otherSize: number,
  onResize: (size: number) => void,
): void {
  let direction = 0;
  if (side === 'bottom') {
    if (event.key === 'ArrowUp') direction = 1;
    else if (event.key === 'ArrowDown') direction = -1;
  } else if (event.key === 'ArrowLeft') {
    direction = side === 'left' ? -1 : 1;
  } else if (event.key === 'ArrowRight') {
    direction = side === 'left' ? 1 : -1;
  }
  if (direction === 0) return;

  event.preventDefault();
  const limit = DOCK_SIZE_LIMITS[side];
  const next = Math.min(dockSizeMax(side, otherSize), Math.max(limit.min, size + direction * 10));
  onResize(next);
}
