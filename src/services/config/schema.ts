/**
 * 配置 schema：字段、默认值与校验都在这里，主进程与单测共用。
 * 磁盘文件按「字段非法回退默认值」容错；渲染层提交按「非法即拒绝」处理。
 */

export type UiDensity = 'comfortable' | 'compact';
export type ThemePreference = 'system' | 'dark' | 'light';

export interface AppConfig {
  terminal: {
    fontSize: number;
  };
  transfer: {
    concurrency: number;
  };
  ui: {
    density: UiDensity;
    theme: ThemePreference;
  };
  files: {
    openByDefault: boolean;
  };
}

export const CONFIG_VERSION = 1;
export const FONT_SIZE_RANGE = { min: 11, max: 20 } as const;
export const TRANSFER_CONCURRENCY_RANGE = { min: 1, max: 4 } as const;

export interface ConfigFile {
  version: number;
  config: AppConfig;
}

export function defaultConfig(): AppConfig {
  return {
    terminal: { fontSize: 13 },
    transfer: { concurrency: 1 },
    ui: { density: 'comfortable', theme: 'system' },
    files: { openByDefault: true },
  };
}

export function emptyConfigFile(): ConfigFile {
  return { version: CONFIG_VERSION, config: defaultConfig() };
}

/** 读磁盘：根结构或版本不对才整份回退；单个字段坏了只回退该字段。 */
export function parseConfigFile(value: unknown): ConfigFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('配置文件根节点必须是对象');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CONFIG_VERSION) {
    throw new Error(`不支持的配置版本：${String(record.version)}`);
  }
  return { version: CONFIG_VERSION, config: sanitizeConfig(record.config) };
}

export function sanitizeConfig(value: unknown): AppConfig {
  const defaults = defaultConfig();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults;

  const record = value as Record<string, unknown>;
  const terminal = asRecord(record.terminal);
  const transfer = asRecord(record.transfer);
  const ui = asRecord(record.ui);
  const files = asRecord(record.files);

  return {
    terminal: {
      fontSize: readInteger(terminal.fontSize, FONT_SIZE_RANGE, defaults.terminal.fontSize),
    },
    transfer: {
      concurrency: readInteger(transfer.concurrency, TRANSFER_CONCURRENCY_RANGE, defaults.transfer.concurrency),
    },
    ui: {
      density: ui.density === 'compact' || ui.density === 'comfortable' ? ui.density : defaults.ui.density,
      theme:
        ui.theme === 'system' || ui.theme === 'dark' || ui.theme === 'light'
          ? ui.theme
          : defaults.ui.theme,
    },
    files: {
      openByDefault:
        typeof files.openByDefault === 'boolean' ? files.openByDefault : defaults.files.openByDefault,
    },
  };
}

/** 渲染层提交：一个字段不合法就整份拒绝，不静默改用户刚设的值。 */
export function parseConfigInput(value: unknown): AppConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('配置必须是对象');
  }
  const record = value as Record<string, unknown>;
  const terminal = asRecord(record.terminal);
  const transfer = asRecord(record.transfer);
  const ui = asRecord(record.ui);
  const files = asRecord(record.files);

  return {
    terminal: { fontSize: requireInteger(terminal.fontSize, '终端字号', FONT_SIZE_RANGE) },
    transfer: { concurrency: requireInteger(transfer.concurrency, '传输并发', TRANSFER_CONCURRENCY_RANGE) },
    ui: { density: requireDensity(ui.density), theme: requireTheme(ui.theme) },
    files: { openByDefault: requireBoolean(files.openByDefault, '默认展开文件面板') },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readInteger(
  value: unknown,
  range: { min: number; max: number },
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
    ? value
    : fallback;
}

function requireInteger(value: unknown, label: string, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${label}必须是 ${range.min}–${range.max} 的整数`);
  }
  return value;
}

function requireDensity(value: unknown): UiDensity {
  if (value === 'compact' || value === 'comfortable') return value;
  throw new Error('界面密度只能是 comfortable 或 compact');
}

function requireTheme(value: unknown): ThemePreference {
  if (value === 'system' || value === 'dark' || value === 'light') return value;
  throw new Error('外观主题只能是 system、dark 或 light');
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`);
  return value;
}
