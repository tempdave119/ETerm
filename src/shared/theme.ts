/**
 * 外部主题格式与校验。主进程只负责读盘与校验，渲染层按校验后的对象覆盖颜色；
 * 两端共用这份白名单，避免「校验放行、应用拒绝」两套规则。
 */

export type ThemeBase = 'dark' | 'light';
export type ExternalThemePreference = `ext:${string}`;
export type ThemePreference = 'system' | 'dark' | 'light' | ExternalThemePreference;

/** 只开放颜色 token；字号 / 间距 / 圆角 / 尺寸不跟外部主题走。 */
export const UI_THEME_TOKENS = [
  '--bg-canvas',
  '--bg-panel',
  '--bg-overlay',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-disabled',
  '--border-subtle',
  '--border-strong',
  '--status-success',
  '--status-warning',
  '--status-danger',
  '--status-info',
  '--hover-subtle',
  '--hover-overlay',
  '--active-overlay',
  '--backdrop',
  '--primary-bg',
  '--primary-text',
  '--primary-hover',
  '--primary-active',
] as const;

export type UiThemeToken = (typeof UI_THEME_TOKENS)[number];

export const TERMINAL_THEME_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'selectionInactiveBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

export type TerminalThemeKey = (typeof TERMINAL_THEME_KEYS)[number];

export interface ThemeDefinition {
  id: string;
  name: string;
  base: ThemeBase;
  ui: Partial<Record<UiThemeToken, string>>;
  terminal: Partial<Record<TerminalThemeKey, string>>;
}

export const RESERVED_THEME_IDS = new Set(['system', 'dark', 'light']);
export const THEME_FILE_MAX_BYTES = 64 * 1024;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/;

/** 只接受十六进制与 rgb/rgba；挡住 var()、颜色名和带分号的注入。 */
export function isThemeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const color = value.trim();
  if (HEX_COLOR.test(color)) return true;
  const match = RGB_COLOR.exec(color);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = match[4] === undefined ? 0 : Number(match[4]);
  return red <= 255 && green <= 255 && blue <= 255 && alpha >= 0 && alpha <= 1;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  if (value === 'system' || value === 'dark' || value === 'light') return true;
  return typeof value === 'string' && value.startsWith('ext:') && ID_PATTERN.test(value.slice(4));
}

export function externalThemeId(preference: ThemePreference): string | null {
  return preference.startsWith('ext:') ? preference.slice(4) : null;
}

/** 单个主题文件非法时整份拒绝，由调用方记日志并跳过；不静默截断字段。 */
export function parseThemeDefinition(raw: unknown): ThemeDefinition {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('主题文件根节点必须是对象');
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!ID_PATTERN.test(id)) {
    throw new Error('主题 id 必须是 1–32 位小写字母、数字或短横线');
  }
  if (RESERVED_THEME_IDS.has(id)) {
    throw new Error(`主题 id 不能使用保留名：${id}`);
  }
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name || name.length > 40) {
    throw new Error('主题 name 必须是 1–40 个字符');
  }
  if (record.base !== 'dark' && record.base !== 'light') {
    throw new Error('主题 base 只能是 dark 或 light');
  }

  const ui = parseTokenMap(record.ui, UI_THEME_TOKENS, 'ui');
  const terminal = parseTokenMap(record.terminal, TERMINAL_THEME_KEYS, 'terminal');
  if (Object.keys(ui).length === 0 && Object.keys(terminal).length === 0) {
    throw new Error('主题至少需要覆盖一个 ui 或 terminal 颜色');
  }

  return { id, name, base: record.base, ui, terminal };
}

function parseTokenMap<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
): Partial<Record<T, string>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`主题 ${label} 必须是对象`);
  }
  const allowedKeys = new Set<string>(allowed);
  const entries: Partial<Record<T, string>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`主题 ${label} 含未知键：${key}`);
    }
    if (!isThemeColor(value)) {
      throw new Error(`主题 ${label}.${key} 不是有效颜色`);
    }
    entries[key as T] = value.trim();
  }
  return entries;
}
