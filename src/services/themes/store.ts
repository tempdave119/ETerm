/**
 * 主题只读存储：扫描 <userData>/themes/*.json 与已启用插件的 themes/*.json。
 * 不依赖 Electron，单测可直接用临时目录；插件主题 id 与外部主题冲突时保留外部主题。
 */

import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseThemeDefinition,
  THEME_FILE_MAX_BYTES,
  type ThemeDefinition,
} from '../../shared/theme.ts';

export interface PluginThemeDir {
  pluginId: string;
  directory: string;
}

export interface ThemeStoreOptions {
  baseDir: string;
  logger?: (message: string, detail?: unknown) => void;
  /** 已启用插件的目录列表；禁用插件不应出现在这里。 */
  pluginThemeDirs?: () => Promise<PluginThemeDir[]>;
}

export class ThemeStore {
  readonly #directory: string;
  readonly #log: (message: string, detail?: unknown) => void;
  readonly #pluginThemeDirs: (() => Promise<PluginThemeDir[]>) | null;

  constructor(options: ThemeStoreOptions) {
    this.#directory = join(options.baseDir, 'themes');
    this.#log = options.logger ?? ((message, detail) => console.warn(`[themes] ${message}`, detail ?? ''));
    this.#pluginThemeDirs = options.pluginThemeDirs ?? null;
  }

  get directory(): string {
    return this.#directory;
  }

  /** 外部主题在前、插件主题在后；坏文件不影响其他主题，重复 id 保留先到的一份。 */
  async list(): Promise<ThemeDefinition[]> {
    const themes = await this.#listDirectory(this.#directory, '外部主题', true);
    const seen = new Set(themes.map((theme) => theme.id));

    if (this.#pluginThemeDirs) {
      let dirs: PluginThemeDir[] = [];
      try {
        dirs = await this.#pluginThemeDirs();
      } catch (error) {
        this.#log('读取插件主题目录失败', error);
      }

      for (const { pluginId, directory } of dirs) {
        const pluginThemes = await this.#listDirectory(join(directory, 'themes'), `插件 ${pluginId}`, false);
        for (const theme of pluginThemes) {
          if (seen.has(theme.id)) {
            this.#log(`插件 ${pluginId} 的主题 ${theme.id} 已跳过`, 'id 与已有主题冲突');
            continue;
          }
          seen.add(theme.id);
          themes.push(theme);
        }
      }
    }

    return themes;
  }

  async #listDirectory(directory: string, label: string, create: boolean): Promise<ThemeDefinition[]> {
    if (create) await mkdir(directory, { recursive: true });

    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const themes: ThemeDefinition[] = [];
    const seen = new Set<string>();
    for (const entry of entries.filter((item) => item.endsWith('.json')).sort()) {
      const path = join(directory, entry);
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
        this.#log(`${label} ${entry} 已跳过`, detail);
      }
    }
    return themes;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}