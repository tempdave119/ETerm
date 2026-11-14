/**
 * 配置 schema：字段、默认值与校验都在这里，主进程与单测共用。
 * 磁盘文件按「字段非法回退默认值」容错；渲染层提交按「非法即拒绝」处理。
 */

import type { ShortcutOverrides, ShortcutSpec } from '../../shared/shortcut.ts';
import { isThemePreference, type ThemePreference } from '../../shared/theme.ts';
import {
  DEFAULT_TERMINAL_CURSOR_STYLE,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  DEFAULT_TERMINAL_SCROLLBACK,
  TERMINAL_CURSOR_STYLES,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_OPTIONS,
  type TerminalCursorStyle,
  type TerminalFontFamily,
} from '../../shared/terminal-font.ts';

export type { ThemePreference };

export type UiDensity = 'comfortable' | 'compact';
export type LanguagePreference = 'system' | 'zh-CN' | 'en-US';
export type MonitorProcessSort = 'memory' | 'cpu';
export type RightClickAction = 'paste' | 'menu' | 'off';

export interface AppConfig {
  terminal: {
    fontSize: number;
    /** 字体族预置：只开放内置几种，避免用户填了系统解析不到的字体名。 */
    fontFamily: TerminalFontFamily;
    lineHeight: number;
    cursorStyle: TerminalCursorStyle;
    cursorBlink: boolean;
    /** 滚回缓冲行数；只在新建终端时生效。 */
    scrollback: number;
    rightClick: RightClickAction;
    /** 仅 rightClick = paste 时生效：有选中内容时复制，否则粘贴。 */
    rightClickCopySelection: boolean;
    /** 本地终端启动命令；空值使用系统默认登录 shell。 */
    localCommand: string;
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
    /** 界面语言；system 按系统语言归一。 */
    language: LanguagePreference;
    /** 资源面板「占用最高进程」的排序，跨重启保留。 */
    monitorProcessSort: MonitorProcessSort;
    /** 首次启动引导是否已读；关闭后不再展示。 */
    onboarded: boolean;
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
export const LOCAL_COMMAND_MAX = 200;
export const KEEPALIVE_INTERVAL_RANGE = { min: 10, max: 300 } as const;
export const KEEPALIVE_COUNT_RANGE = { min: 1, max: 5 } as const;
export const TRANSFER_CONCURRENCY_RANGE = { min: 1, max: 4 } as const;

export interface ConfigFile {
  version: number;
  config: AppConfig;
}

export function defaultConfig(): AppConfig {
  return {
    terminal: {
      fontSize: 13,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      cursorStyle: DEFAULT_TERMINAL_CURSOR_STYLE,
      cursorBlink: true,
      scrollback: DEFAULT_TERMINAL_SCROLLBACK,
      rightClick: 'paste',
      rightClickCopySelection: false,
      localCommand: '',
    },
    ssh: { keepaliveInterval: 30, keepaliveCountMax: 3 },
    transfer: { concurrency: 1 },
    ui: { density: 'comfortable', theme: 'system', language: 'system', monitorProcessSort: 'memory', onboarded: false },
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
      fontFamily: readFontFamily(terminal.fontFamily, defaults.terminal.fontFamily),
      lineHeight: readLineHeight(terminal.lineHeight, defaults.terminal.lineHeight),
      cursorStyle: readCursorStyle(terminal.cursorStyle, defaults.terminal.cursorStyle),
      cursorBlink: readBoolean(terminal.cursorBlink, defaults.terminal.cursorBlink),
      scrollback: readScrollback(terminal.scrollback, defaults.terminal.scrollback),
      rightClick: readRightClick(terminal.rightClick, defaults.terminal.rightClick),
      rightClickCopySelection: readBoolean(
        terminal.rightClickCopySelection,
        defaults.terminal.rightClickCopySelection,
      ),
      localCommand: readCommand(terminal.localCommand, defaults.terminal.localCommand),
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
      theme: isThemePreference(ui.theme) ? ui.theme : defaults.ui.theme,
      language: readLanguage(ui.language, defaults.ui.language),
      monitorProcessSort:
        ui.monitorProcessSort === 'memory' || ui.monitorProcessSort === 'cpu'
          ? ui.monitorProcessSort
          : defaults.ui.monitorProcessSort,
      onboarded: readBoolean(ui.onboarded, defaults.ui.onboarded),
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
      fontFamily: requireFontFamily(terminal.fontFamily),
      lineHeight: requireLineHeight(terminal.lineHeight),
      cursorStyle: requireCursorStyle(terminal.cursorStyle),
      cursorBlink: requireBoolean(terminal.cursorBlink, '光标闪烁'),
      scrollback: requireScrollback(terminal.scrollback),
      rightClick: requireRightClick(terminal.rightClick),
      rightClickCopySelection: requireBoolean(terminal.rightClickCopySelection, '选中时复制'),
      localCommand: requireCommand(terminal.localCommand),
    },
    ssh: {
      keepaliveInterval: requireInteger(ssh.keepaliveInterval, '保活间隔', KEEPALIVE_INTERVAL_RANGE),
      keepaliveCountMax: requireInteger(ssh.keepaliveCountMax, '保活重试次数', KEEPALIVE_COUNT_RANGE),
    },
    transfer: { concurrency: requireInteger(transfer.concurrency, '传输并发', TRANSFER_CONCURRENCY_RANGE) },
    ui: {
      density: requireDensity(ui.density),
      theme: requireTheme(ui.theme),
      language: requireLanguage(ui.language),
      monitorProcessSort: requireMonitorProcessSort(ui.monitorProcessSort),
      onboarded: requireBoolean(ui.onboarded, '首次启动引导'),
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

function readFontFamily(value: unknown, fallback: TerminalFontFamily): TerminalFontFamily {
  return typeof value === 'string' && (TERMINAL_FONT_FAMILIES as readonly string[]).includes(value)
    ? (value as TerminalFontFamily)
    : fallback;
}

function requireFontFamily(value: unknown): TerminalFontFamily {
  if (typeof value === 'string' && (TERMINAL_FONT_FAMILIES as readonly string[]).includes(value)) {
    return value as TerminalFontFamily;
  }
  throw new Error(`终端字体只能是 ${TERMINAL_FONT_FAMILIES.join(' / ')}`);
}

/** 行高保留两位小数：滑块以 0.05 步进，手改文件也不能塞进多位小数。 */
function normalizeLineHeight(value: number): number {
  return Math.round(value * 100) / 100;
}

function readLineHeight(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = normalizeLineHeight(value);
  return rounded >= TERMINAL_LINE_HEIGHT_RANGE.min && rounded <= TERMINAL_LINE_HEIGHT_RANGE.max
    ? rounded
    : fallback;
}

function requireLineHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('行高必须是数字');
  const rounded = normalizeLineHeight(value);
  if (rounded < TERMINAL_LINE_HEIGHT_RANGE.min || rounded > TERMINAL_LINE_HEIGHT_RANGE.max) {
    throw new Error(`行高必须在 ${TERMINAL_LINE_HEIGHT_RANGE.min}–${TERMINAL_LINE_HEIGHT_RANGE.max} 之间`);
  }
  return rounded;
}

function readCursorStyle(value: unknown, fallback: TerminalCursorStyle): TerminalCursorStyle {
  return typeof value === 'string' && (TERMINAL_CURSOR_STYLES as readonly string[]).includes(value)
    ? (value as TerminalCursorStyle)
    : fallback;
}

function requireCursorStyle(value: unknown): TerminalCursorStyle {
  if (typeof value === 'string' && (TERMINAL_CURSOR_STYLES as readonly string[]).includes(value)) {
    return value as TerminalCursorStyle;
  }
  throw new Error(`光标样式只能是 ${TERMINAL_CURSOR_STYLES.join(' / ')}`);
}

function readScrollback(value: unknown, fallback: number): number {
  return typeof value === 'number' && (TERMINAL_SCROLLBACK_OPTIONS as readonly number[]).includes(value)
    ? value
    : fallback;
}

function requireScrollback(value: unknown): number {
  if (typeof value === 'number' && (TERMINAL_SCROLLBACK_OPTIONS as readonly number[]).includes(value)) return value;
  throw new Error(`滚回缓冲只能是 ${TERMINAL_SCROLLBACK_OPTIONS.join(' / ')} 行`);
}

/** 读磁盘：启动命令非法时回落默认（空值）。 */
function readCommand(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > LOCAL_COMMAND_MAX ? fallback : trimmed;
}

function requireCommand(value: unknown): string {
  if (typeof value !== 'string') throw new Error('启动命令必须是字符串');
  const trimmed = value.trim();
  if (trimmed.length > LOCAL_COMMAND_MAX) {
    throw new Error(`启动命令不能超过 ${LOCAL_COMMAND_MAX} 个字符`);
  }
  return trimmed;
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
  if (isThemePreference(value)) return value;
  throw new Error('外观主题只能是 system、dark、light 或 ext:<id>');
}

function readLanguage(value: unknown, fallback: LanguagePreference): LanguagePreference {
  return value === 'system' || value === 'zh-CN' || value === 'en-US' ? value : fallback;
}

function requireLanguage(value: unknown): LanguagePreference {
  if (value === 'system' || value === 'zh-CN' || value === 'en-US') return value;
  throw new Error('界面语言只能是 system、zh-CN 或 en-US');
}

function requireMonitorProcessSort(value: unknown): MonitorProcessSort {
  if (value === 'memory' || value === 'cpu') return value;
  throw new Error('进程排序只能是 memory 或 cpu');
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`);
  return value;
}
