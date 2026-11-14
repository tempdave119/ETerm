/**
 * 主题解析与应用：内置深浅两套兜底，外部主题只覆盖白名单颜色。
 * 变量挂在 html 上，切换时不重建面板；xterm 只认具体值，由这里合并调色板。
 */

import type { ITheme } from '@xterm/xterm';
import {
  UI_THEME_TOKENS,
  externalThemeId,
  type ThemeBase,
  type ThemeDefinition,
  type ThemePreference,
} from '../shared/theme.ts';

// xterm 只认具体值，不认 CSS 变量；两套调色板与 tokens.css 的深浅色保持同值。
export const TERMINAL_THEMES: Record<ThemeBase, ITheme> = {
  dark: {
    background: '#16181c',
    foreground: '#e6e8eb',
    cursor: '#7aa2f7',
    selectionBackground: 'rgba(122, 162, 247, 0.28)',
    black: '#1b1e24',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#c0caf5',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#e6e8eb',
  },
  light: {
    background: '#f5f6f8',
    foreground: '#1c1f24',
    cursor: '#2b6cb0',
    selectionBackground: 'rgba(43, 108, 176, 0.2)',
    black: '#1c1f24',
    red: '#c93c52',
    green: '#3f7d20',
    yellow: '#9a6700',
    blue: '#2b6cb0',
    magenta: '#8b4aa0',
    cyan: '#0e7490',
    white: '#4d545d',
    brightBlack: '#737b86',
    brightRed: '#e05570',
    brightGreen: '#4f9a2a',
    brightYellow: '#b57d00',
    brightBlue: '#3b82c4',
    brightMagenta: '#a45cb8',
    brightCyan: '#1490a8',
    brightWhite: '#1c1f24',
  },
};

export interface ResolvedTheme {
  base: ThemeBase;
  definition: ThemeDefinition | null;
  /** 选中的外部主题文件缺失；界面仍按系统主题显示。 */
  missing: boolean;
}

export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ThemeBase,
  themes: ThemeDefinition[],
): ResolvedTheme {
  if (preference === 'dark' || preference === 'light') {
    return { base: preference, definition: null, missing: false };
  }
  if (preference === 'system') {
    return { base: systemTheme, definition: null, missing: false };
  }

  const id = externalThemeId(preference);
  const definition = id ? (themes.find((theme) => theme.id === id) ?? null) : null;
  if (definition) return { base: definition.base, definition, missing: false };
  return { base: systemTheme, definition: null, missing: true };
}

export function terminalThemeFor(base: ThemeBase, definition: ThemeDefinition | null): ITheme {
  return { ...TERMINAL_THEMES[base], ...(definition?.terminal ?? {}) };
}

/** 切换主题先清空上一份外部覆盖，再写入当前主题提供的颜色。 */
export function applyUiTheme(base: ThemeBase, definition: ThemeDefinition | null): void {
  const root = document.documentElement;
  root.dataset.theme = base;
  for (const token of UI_THEME_TOKENS) root.style.removeProperty(token);
  if (!definition) return;
  for (const [token, value] of Object.entries(definition.ui)) {
    root.style.setProperty(token, value);
  }
}
