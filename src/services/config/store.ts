import { join } from 'node:path';
import { JsonFile } from '../storage/json-file.ts';
import {
  CONFIG_VERSION,
  defaultConfig,
  emptyConfigFile,
  parseConfigFile,
  type AppConfig,
  type ConfigFile,
} from './schema.ts';

export interface ConfigStoreOptions {
  baseDir: string;
  logger?: (message: string, detail?: unknown) => void;
}

/**
 * config.json 只存用户配置；原子写与坏文件备份回退交给 JsonFile。
 * 与 layout.json 分开：布局是高频写的状态，配置是低频写的偏好。
 */
export class ConfigStore {
  readonly #file: JsonFile<ConfigFile>;

  constructor(options: ConfigStoreOptions) {
    this.#file = new JsonFile<ConfigFile>({
      filePath: join(options.baseDir, 'config.json'),
      empty: emptyConfigFile,
      parse: parseConfigFile,
      logger: options.logger,
    });
  }

  async get(): Promise<AppConfig> {
    return structuredClone((await this.#file.read()).config);
  }

  async save(config: AppConfig): Promise<AppConfig> {
    return this.#file.update((file) => {
      file.version = CONFIG_VERSION;
      file.config = structuredClone(config);
      return structuredClone(config);
    });
  }

  async reset(): Promise<AppConfig> {
    return this.save(defaultConfig());
  }
}
