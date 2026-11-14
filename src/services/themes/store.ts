/**
 * 外部主题只读存储：扫描 <userData>/themes/*.json，非法文件跳过并记日志。
 * 不依赖 Electron，单测可直接用临时目录。
 */

import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseThemeDefinition,
  THEME_FILE_MAX_BYTES,
  type ThemeDefinition,
} from '../../shared/theme.ts';

export interface ThemeStoreOptions {
  baseDir: string;
  logger?: (message: string, detail?: unknown) => void;
}

export class ThemeStore {
  readonly #directory: string;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: ThemeStoreOptions) {
    this.#directory = join(options.baseDir, 'themes');
    this.#log = options.logger ?? ((message, detail) => console.warn(`[themes] ${message}`, detail ?? ''));
  }

  get directory(): string {
    return this.#directory;
  }

  /** 目录不存在时创建；坏文件不影响其他主题，重复 id 保留排序靠前的一份。 */
  async list(): Promise<ThemeDefinition[]> {
    await mkdir(this.#directory, { recursive: true });
    const entries = (await readdir(this.#directory)).filter((entry) => entry.endsWith('.json')).sort();
    const themes: ThemeDefinition[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      const path = join(this.#directory, entry);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        if (info.size > THEME_FILE_MAX_BYTES) {
          throw new Error(`主题文件超过 ${THEME_FILE_MAX_BYTES} 字节`);
        }
        const theme = parseThemeDefinition(JSON.parse(await readFile(path, 'utf8')));
        if (seen.has(theme.id)) {
          throw new Error(`主题 id 重复：${theme.id}`);
        }
        seen.add(theme.id);
        themes.push(theme);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.#log(`主题 ${entry} 已跳过`, detail);
      }
    }

    return themes;
  }
}
