/** 窗口尺寸计算：默认居中、保存位置校验与多显示器回退，纯函数便于单测。 */

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1080, height: 720 };
export const MIN_WINDOW_SIZE: WindowSize = { width: 720, height: 480 };

export function defaultWindowBounds(
  workArea: WindowRect,
  size: WindowSize = DEFAULT_WINDOW_SIZE,
): WindowRect {
  const width = Math.max(1, Math.min(size.width, workArea.width));
  const height = Math.max(1, Math.min(size.height, workArea.height));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/**
 * 保存位置只要碰到任意显示器就沿用并夹取到该屏；完全在屏幕外、
 * 或显示器被拔掉时，回退到当前鼠标所在屏居中。
 */
export function fitWindowBounds(
  saved: WindowRect | null,
  displays: readonly WindowRect[],
  fallback: WindowRect,
): WindowRect {
  if (!saved || !isUsableRect(saved)) return defaultWindowBounds(fallback);

  const display = bestDisplay(saved, displays);
  if (!display) return defaultWindowBounds(fallback);

  const width = Math.min(Math.max(Math.round(saved.width), MIN_WINDOW_SIZE.width), display.width);
  const height = Math.min(Math.max(Math.round(saved.height), MIN_WINDOW_SIZE.height), display.height);
  return {
    x: clamp(Math.round(saved.x), display.x, display.x + display.width - width),
    y: clamp(Math.round(saved.y), display.y, display.y + display.height - height),
    width,
    height,
  };
}

function isUsableRect(rect: WindowRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= MIN_WINDOW_SIZE.width &&
    rect.height >= MIN_WINDOW_SIZE.height
  );
}

function bestDisplay(saved: WindowRect, displays: readonly WindowRect[]): WindowRect | null {
  let best: WindowRect | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const area = intersectionArea(saved, display);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return best;
}

function intersectionArea(a: WindowRect, b: WindowRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
