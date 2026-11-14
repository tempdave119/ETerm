/** 窗口尺寸 / 位置持久化；坏文件由 JsonFile 备份并回退默认。 */

import { join } from 'node:path';
import { JsonFile } from '../storage/json-file.ts';
import { MIN_WINDOW_SIZE, type WindowRect } from '../../shared/window-bounds.ts';

export interface WindowState {
  bounds: WindowRect | null;
  maximized: boolean;
}

export interface WindowStateStoreOptions {
  baseDir: string;
  logger?: (message: string, detail?: unknown) => void;
}

export function emptyWindowState(): WindowState {
  return { bounds: null, maximized: false };
}

export function parseWindowState(raw: unknown): WindowState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyWindowState();
  const record = raw as Record<string, unknown>;
  return {
    bounds: readBounds(record.bounds),
    maximized: record.maximized === true,
  };
}

function readBounds(raw: unknown): WindowRect | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  const width = record.width;
  const height = record.height;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_WINDOW_SIZE.width ||
    height < MIN_WINDOW_SIZE.height
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export class WindowStateStore {
  readonly #file: JsonFile<WindowState>;

  constructor(options: WindowStateStoreOptions) {
    this.#file = new JsonFile({
      filePath: join(options.baseDir, 'window-state.json'),
      empty: emptyWindowState,
      parse: parseWindowState,
      logger: options.logger,
    });
  }

  async load(): Promise<WindowState> {
    return this.#file.read();
  }

  async save(state: WindowState): Promise<void> {
    await this.#file.update((current) => {
      current.bounds = state.bounds;
      current.maximized = state.maximized;
    });
  }
}
