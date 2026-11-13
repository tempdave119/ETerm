import { join } from 'node:path';
import {
  countTemplateLeaves,
  parseLayoutTemplate,
  type LayoutTemplate,
} from '../../shared/layout-template.ts';
import { defaultPanelLayout, parsePanelLayout, type PanelLayout } from '../../shared/panels.ts';
import { JsonFile } from '../storage/json-file.ts';

const VERSION = 1;

interface LayoutFile {
  version: number;
  splits: Record<string, LayoutTemplate>;
  panels: PanelLayout;
}

/** 按连接记忆分屏结构：只存树形与比例，不存 sessionId。 */
export class LayoutStore {
  readonly #file: JsonFile<LayoutFile>;

  constructor(options: { baseDir: string; logger?: (message: string, detail?: unknown) => void }) {
    this.#file = new JsonFile<LayoutFile>({
      filePath: join(options.baseDir, 'layout.json'),
      empty: emptyFile,
      parse: parseFile,
      logger: options.logger,
    });
  }

  async get(key: string): Promise<LayoutTemplate | null> {
    assertKey(key);
    const file = await this.#file.read();
    const template = file.splits[key];
    return template ? structuredClone(template) : null;
  }

  async save(key: string, template: LayoutTemplate): Promise<void> {
    assertKey(key);
    const parsed = parseLayoutTemplate(template);
    await this.#file.update((file) => {
      if (countTemplateLeaves(parsed) <= 1) delete file.splits[key];
      else file.splits[key] = structuredClone(parsed);
    });
  }

  async getPanels(): Promise<PanelLayout> {
    return structuredClone((await this.#file.read()).panels);
  }

  async savePanels(state: PanelLayout): Promise<void> {
    await this.#file.update((file) => {
      file.panels = parsePanelLayout(state);
    });
  }
}

function assertKey(key: string): void {
  if (!key.trim() || key.length > 64) throw new Error('布局 key 必须是 1–64 字符');
}

function emptyFile(): LayoutFile {
  return { version: VERSION, splits: {}, panels: defaultPanelLayout() };
}

function parseFile(value: unknown): LayoutFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('layout.json 根节点必须是对象');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION) throw new Error(`不支持的 layout 版本：${String(record.version)}`);
  if (typeof record.splits !== 'object' || record.splits === null || Array.isArray(record.splits)) {
    throw new Error('layout splits 必须是对象');
  }

  const splits: Record<string, LayoutTemplate> = {};
  for (const [key, template] of Object.entries(record.splits)) {
    assertKey(key);
    splits[key] = parseLayoutTemplate(template);
  }
  return { version: VERSION, splits, panels: parsePanelLayout(record.panels) };
}
