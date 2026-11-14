/**
 * 配置 schema：字段、默认值与校验都在这里，主进程与单测共用。
 * 磁盘文件按「字段非法回退默认值」容错；渲染层提交按「非法即拒绝」处理。
 */

import type { ShortcutOverrides, ShortcutSpec } from '../../shared/shortcut.ts';

export type UiDensity = 'comfortable' | 'compact';
export type ThemePreference = 'system' | 'dark' | 'light';
export type MonitorProcessSort = 'memory' | 'cpu';
export type RightClickAction = 'paste' | 'menu' | 'off';

export interface AppConfig {
  terminal: {
    fontSize: number;
    rightClick: RightClickAction;
    /** 仅 rightClick = paste 时生效：有选中内容时复制，否则粘贴。 */
    rightClickCopySelection: boolean;
  };
  ssh: {
    /** 秒；每 N 秒发一次 keepalive 全局请求。 */
    keepaliveInterval: number;
    /** 连续无响应达到上限才断开。 */
    keepaliveCountMax: number;
  };
  transfer: {
    concurrency: number;
  };
  ui: {
    density: UiDensity;
    theme: ThemePreference;
    /** 资源面板「占用最高进程」的排序，跨重启保留。 */
    monitorProcessSort: MonitorProcessSort;
  };
  files: {
    openByDefault: boolean;
  };
  shortcuts: {
    /** 只存与命令注册表默认值的差异；null 为解绑。 */
    overrides: ShortcutOverrides;
  };
}

export const CONFIG_VERSION = 1;
export const FONT_SIZE_RANGE = { min: 11, max: 20 } as const;
export const KEEPALIVE_INTERVAL_RANGE = { min: 10, max: 300 } as const;
export const KEEPALIVE_COUNT_RANGE = { min: 1, max: 5 } as const;
export const TRANSFER_CONCURRENCY_RANGE = { min: 1, max: 4 } as const;

export interface ConfigFile {
  version: number;
  config: AppConfig;
}

export function defaultConfig(): AppConfig {
  return {
    terminal: { fontSize: 13, rightClick: 'paste', rightClickCopySelection: false },
    ssh: { keepaliveInterval: 30, keepaliveCountMax: 3 },
    transfer: { concurrency: 1 },
    ui: { density: 'comfortable', theme: 'system', monitorProcessSort: 'memory' },
    files: { openByDefault: true },
    shortcuts: { overrides: {} },
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
  const ssh = asRecord(record.ssh);
  const transfer = asRecord(record.transfer);
  const ui = asRecord(record.ui);
  const files = asRecord(record.files);
  const shortcuts = asRecord(record.shortcuts);

  return {
    terminal: {
      fontSize: readInteger(terminal.fontSize, FONT_SIZE_RANGE, defaults.terminal.fontSize),
      rightClick: readRightClick(terminal.rightClick, defaults.terminal.rightClick),
      rightClickCopySelection: readBoolean(
        terminal.rightClickCopySelection,
        defaults.terminal.rightClickCopySelection,
      ),
    },
    ssh: {
      keepaliveInterval: readInteger(
        ssh.keepaliveInterval,
        KEEPALIVE_INTERVAL_RANGE,
        defaults.ssh.keepaliveInterval,
      ),
      keepaliveCountMax: readInteger(ssh.keepaliveCountMax, KEEPALIVE_COUNT_RANGE, defaults.ssh.keepaliveCountMax),
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
      monitorProcessSort:
        ui.monitorProcessSort === 'memory' || ui.monitorProcessSort === 'cpu'
          ? ui.monitorProcessSort
          : defaults.ui.monitorProcessSort,
    },
    files: {
      openByDefault:
        typeof files.openByDefault === 'boolean' ? files.openByDefault : defaults.files.openByDefault,
    },
    shortcuts: { overrides: readShortcuts(shortcuts.overrides) },
  };
}

/** 渲染层提交：一个字段不合法就整份拒绝，不静默改用户刚设的值。 */
export function parseConfigInput(value: unknown): AppConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('配置必须是对象');
  }
  const record = value as Record<string, unknown>;
  const terminal = asRecord(record.terminal);
  const ssh = asRecord(record.ssh);
  const transfer = asRecord(record.transfer);
  const ui = asRecord(record.ui);
  const files = asRecord(record.files);
  const shortcuts = asRecord(record.shortcuts);

  return {
    terminal: {
      fontSize: requireInteger(terminal.fontSize, '终端字号', FONT_SIZE_RANGE),
      rightClick: requireRightClick(terminal.rightClick),
      rightClickCopySelection: requireBoolean(terminal.rightClickCopySelection, '选中时复制'),
    },
    ssh: {
      keepaliveInterval: requireInteger(ssh.keepaliveInterval, '保活间隔', KEEPALIVE_INTERVAL_RANGE),
      keepaliveCountMax: requireInteger(ssh.keepaliveCountMax, '保活重试次数', KEEPALIVE_COUNT_RANGE),
    },
    transfer: { concurrency: requireInteger(transfer.concurrency, '传输并发', TRANSFER_CONCURRENCY_RANGE) },
    ui: {
      density: requireDensity(ui.density),
      theme: requireTheme(ui.theme),
      monitorProcessSort: requireMonitorProcessSort(ui.monitorProcessSort),
    },
    files: { openByDefault: requireBoolean(files.openByDefault, '默认展开文件面板') },
    shortcuts: { overrides: requireShortcuts(shortcuts.overrides) },
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

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readRightClick(value: unknown, fallback: RightClickAction): RightClickAction {
  return value === 'paste' || value === 'menu' || value === 'off' ? value : fallback;
}

/** 读磁盘：单条快捷键坏了就丢掉该条，不影响其他定制。 */
function readShortcuts(value: unknown): ShortcutOverrides {
  const record = asRecord(value);
  const next: ShortcutOverrides = {};
  for (const [id, spec] of Object.entries(record)) {
    if (spec === null) {
      next[id] = null;
      continue;
    }
    const parsed = readShortcutSpec(spec);
    if (parsed) next[id] = parsed;
  }
  return next;
}

function readShortcutSpec(value: unknown): ShortcutSpec | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string' || record.code.length === 0) return null;
  if (record.shift !== undefined && typeof record.shift !== 'boolean') return null;
  return record.shift ? { code: record.code, shift: true } : { code: record.code };
}

/** 渲染层提交：任何一条非法就整份拒绝，不静默改用户刚设的值。 */
function requireShortcuts(value: unknown): ShortcutOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('快捷键配置必须是对象');
  }
  const next: ShortcutOverrides = {};
  for (const [id, spec] of Object.entries(value as Record<string, unknown>)) {
    if (spec === null) {
      next[id] = null;
      continue;
    }
    if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error(`快捷键 ${id} 必须是对象或 null`);
    const record = spec as Record<string, unknown>;
    if (typeof record.code !== 'string' || record.code.length === 0) {
      throw new Error(`快捷键 ${id} 缺少 code`);
    }
    if (record.shift !== undefined && typeof record.shift !== 'boolean') {
      throw new Error(`快捷键 ${id} 的 shift 必须是布尔值`);
    }
    next[id] = record.shift ? { code: record.code, shift: true } : { code: record.code };
  }
  return next;
}

function requireRightClick(value: unknown): RightClickAction {
  if (value === 'paste' || value === 'menu' || value === 'off') return value;
  throw new Error('右键行为只能是 paste、menu 或 off');
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

function requireMonitorProcessSort(value: unknown): MonitorProcessSort {
  if (value === 'memory' || value === 'cpu') return value;
  throw new Error('进程排序只能是 memory 或 cpu');
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`);
  return value;
}
