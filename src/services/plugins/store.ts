import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_VERSION } from '../../core/manifest.ts';
import {
  emptyPluginsFile,
  isPluginApiCompatible,
  parsePluginManifest,
  parsePluginsFile,
  pluginRecordOf,
  type PluginManifest,
  type PluginRecord,
  type PluginsFile,
} from '../../shared/plugins.ts';

export type PluginLogger = (message: string, detail?: unknown) => void;

export interface PluginStoreOptions {
  baseDir: string;
  logger?: PluginLogger;
}

const HOST_MAJOR = API_VERSION.split('.')[0]!;

/**
 * 插件（Plugin）的安装 / 启停 / 卸载与列表。
 * 插件目录独立于扩展的 components/，状态只记禁用列表：目录存在即已安装。
 */
export class PluginStore {
  readonly #pluginsDir: string;
  readonly #statePath: string;
  readonly #log: PluginLogger;
  #stateCache: PluginsFile | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: PluginStoreOptions) {
    this.#pluginsDir = join(options.baseDir, 'plugins');
    this.#statePath = join(options.baseDir, 'plugins.json');
    this.#log =
      options.logger ??
      ((message, detail) => {
        if (detail === undefined) console.warn(`[plugins] ${message}`);
        else console.warn(`[plugins] ${message}`, detail);
      });
  }

  async list(): Promise<PluginRecord[]> {
    const state = await this.#state();
    let entries: string[];
    try {
      entries = await readdir(this.#pluginsDir);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const records: PluginRecord[] = [];
    for (const id of entries.sort()) {
      try {
        const manifest = await this.#readManifest(join(this.#pluginsDir, id));
        if (manifest.id !== id) {
          throw new Error(`manifest.id（${manifest.id}）与目录名（${id}）不一致`);
        }
        if (!isPluginApiCompatible(manifest.apiVersion, HOST_MAJOR)) {
          throw new Error(`apiVersion ${manifest.apiVersion} 与宿主 ${HOST_MAJOR}.x 不兼容`);
        }
        records.push(pluginRecordOf(manifest, !state.disabled.includes(id)));
      } catch (error) {
        this.#log(`插件已跳过：${id}`, error);
      }
    }
    return records;
  }

  async install(sourceDir: string): Promise<PluginRecord> {
    const manifest = await this.#readManifest(sourceDir);
    if (!isPluginApiCompatible(manifest.apiVersion, HOST_MAJOR)) {
      throw new Error(`插件 ${manifest.id} 的 apiVersion ${manifest.apiVersion} 与宿主 ${HOST_MAJOR}.x 不兼容`);
    }

    const target = join(this.#pluginsDir, manifest.id);
    if (await exists(target)) throw new Error(`插件已存在：${manifest.id}`);

    await mkdir(this.#pluginsDir, { recursive: true });
    await cp(sourceDir, target, { recursive: true, force: false, errorOnExist: true });
    await this.#mutate((state) => {
      state.disabled = state.disabled.filter((item) => item !== manifest.id);
    });
    return pluginRecordOf(manifest, true);
  }

  async uninstall(id: string): Promise<void> {
    const target = join(this.#pluginsDir, id);
    if (!(await exists(target))) throw new Error(`插件不存在：${id}`);
    await this.#mutate(async (state) => {
      await rm(target, { recursive: true, force: true });
      state.disabled = state.disabled.filter((item) => item !== id);
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.#readManifest(join(this.#pluginsDir, id));
    await this.#mutate((state) => {
      if (enabled) state.disabled = state.disabled.filter((item) => item !== id);
      else if (!state.disabled.includes(id)) state.disabled.push(id);
    });
  }

  /** 插件面板与静态资源通过自定义协议读取；禁用或 manifest 无效时返回 null。 */
  async panelRoot(id: string): Promise<string | null> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
    const state = await this.#state();
    if (state.disabled.includes(id)) return null;
    try {
      const manifest = await this.#readManifest(join(this.#pluginsDir, id));
      return manifest.id === id ? join(this.#pluginsDir, id) : null;
    } catch {
      return null;
    }
  }

  /** 已启用插件的目录；主题加载器据此扫描 themes/ 子目录。 */
  async themeDirs(): Promise<{ pluginId: string; directory: string }[]> {
    const records = await this.list();
    return records
      .filter((record) => record.enabled)
      .map((record) => ({ pluginId: record.id, directory: join(this.#pluginsDir, record.id) }));
  }

  /** 读并校验插件 manifest；字段错误带上具体原因，安装时直接展示给用户。 */
  async #readManifest(directory: string): Promise<PluginManifest> {
    const file = join(directory, 'manifest.json');
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) throw new Error(`所选目录缺少 manifest.json：${directory}`);
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`manifest.json 不是合法 JSON：${directory}`, { cause: error });
    }
    return parsePluginManifest(parsed);
  }

  async #state(): Promise<PluginsFile> {
    if (this.#stateCache) return this.#stateCache;
    try {
      const raw = await readFile(this.#statePath, 'utf8');
      this.#stateCache = parsePluginsFile(JSON.parse(raw));
    } catch (error) {
      if (!isMissingFile(error)) this.#log('plugins.json 无法解析，已回退为空状态', error);
      this.#stateCache = emptyPluginsFile();
    }
    return this.#stateCache;
  }

  #mutate<T>(change: (state: PluginsFile) => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      const state = await this.#state();
      const result = await change(state);
      await this.#persist(state);
      return result;
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #persist(state: PluginsFile): Promise<void> {
    await mkdir(this.#pluginsDir, { recursive: true });
    const tempPath = `${this.#statePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.#statePath);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}