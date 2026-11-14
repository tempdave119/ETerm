import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { PluginStore } from '../services/plugins/store.ts';
import {
  parsePluginCommandId,
  pluginCommandId,
  type PluginCommandInfo,
  type PluginManifest,
} from '../shared/plugins.ts';

export type PluginRuntimeLogger = (message: string, detail?: unknown) => void;

interface LoadedPlugin {
  id: string;
  commands: Map<string, () => void | Promise<void>>;
  titles: Map<string, string>;
  dispose: (() => void) | null;
}

interface PluginApi {
  /** 注册 manifest 已声明的命令；未声明或 handler 不是函数直接抛错。 */
  registerCommand(commandId: string, run: () => void | Promise<void>): void;
}

export interface PluginRuntimeOptions {
  store: PluginStore;
  logger?: PluginRuntimeLogger;
}

/**
 * 插件命令运行时：启动时加载已启用插件的 CJS 入口并执行 activate(api)。
 * 与扩展一致，插件在主进程内运行、无沙箱；装载失败只跳过该插件并记日志。
 */
export class PluginRuntime {
  readonly #store: PluginStore;
  readonly #log: PluginRuntimeLogger;
  #loaded: LoadedPlugin[] = [];

  constructor(options: PluginRuntimeOptions) {
    this.#store = options.store;
    this.#log =
      options.logger ??
      ((message, detail) => {
        if (detail === undefined) console.warn(`[plugins] ${message}`);
        else console.warn(`[plugins] ${message}`, detail);
      });
  }

  async start(): Promise<void> {
    const plugins = await this.#store.enabledPlugins();
    for (const { manifest, directory } of plugins) {
      try {
        this.#loaded.push(await this.#activate(manifest, directory));
      } catch (error) {
        this.#log(`插件 ${manifest.id} 的命令未加载`, error);
      }
    }
  }

  listCommands(): PluginCommandInfo[] {
    return this.#loaded.flatMap((plugin) =>
      [...plugin.commands.keys()].map((commandId) => ({
        id: pluginCommandId(plugin.id, commandId),
        title: plugin.titles.get(commandId) ?? commandId,
        pluginId: plugin.id,
      })),
    );
  }

  async runCommand(id: string): Promise<void> {
    const parsed = parsePluginCommandId(id);
    if (!parsed) throw new Error(`未知插件命令：${id}`);
    const plugin = this.#loaded.find((item) => item.id === parsed.pluginId);
    const handler = plugin?.commands.get(parsed.commandId);
    if (!handler) throw new Error(`插件 ${parsed.pluginId} 未提供命令：${parsed.commandId}`);
    await handler();
  }

  dispose(): void {
    for (const plugin of this.#loaded) {
      try {
        plugin.dispose?.();
      } catch (error) {
        this.#log(`插件 ${plugin.id} dispose 失败`, error);
      }
    }
    this.#loaded = [];
  }

  async #activate(manifest: PluginManifest, directory: string): Promise<LoadedPlugin> {
    const entryPath = join(directory, manifest.entry);
    const requireFromPlugin = createRequire(entryPath);
    const entry = requireFromPlugin(entryPath) as
      | { activate?: (api: PluginApi) => unknown; dispose?: () => void }
      | null;
    if (!entry || typeof entry.activate !== 'function') {
      throw new Error('入口未导出 activate(api)');
    }

    const declared = new Map(manifest.commands.map((command) => [command.id, command]));
    const commands = new Map<string, () => void | Promise<void>>();
    const api: PluginApi = {
      registerCommand(commandId, run) {
        if (!declared.has(commandId)) throw new Error(`命令未在 manifest 声明：${commandId}`);
        if (typeof run !== 'function') throw new Error(`命令 handler 必须是函数：${commandId}`);
        commands.set(commandId, run);
      },
    };

    const result = (await entry.activate(api)) as { dispose?: unknown } | undefined;
    const dispose =
      typeof entry.dispose === 'function'
        ? entry.dispose
        : typeof result?.dispose === 'function'
          ? (result.dispose as () => void)
          : null;

    return {
      id: manifest.id,
      commands,
      titles: new Map(manifest.commands.map((command) => [command.id, command.title])),
      dispose,
    };
  }
}