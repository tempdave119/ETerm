/**
 * 终端外观枚举：schema 校验、设置面板下拉与 xterm 选项共用一份，
 * 避免字面量与映射散落在主进程和渲染层各写一遍。
 */

export const TERMINAL_FONT_FAMILIES = ['sf-mono', 'menlo', 'monaco', 'system-mono'] as const;
export type TerminalFontFamily = (typeof TERMINAL_FONT_FAMILIES)[number];

/**
 * SFMono-Regular 不是 macOS 可解析的 family 名（系统私有字体为 .SF NS Mono，Chromium 拒绝访问），
 * 写进去只会被跳过；显式落到 Menlo，装了 SF Mono 的机器优先用它。
 */
export const TERMINAL_FONT_STACKS: Record<TerminalFontFamily, string> = {
  'sf-mono': '"SF Mono", Menlo, Monaco, "Courier New", monospace',
  menlo: 'Menlo, Monaco, "Courier New", monospace',
  monaco: 'Monaco, Menlo, "Courier New", monospace',
  'system-mono': 'ui-monospace, Menlo, Monaco, "Courier New", monospace',
};

export const TERMINAL_CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
export type TerminalCursorStyle = (typeof TERMINAL_CURSOR_STYLES)[number];

export const TERMINAL_SCROLLBACK_OPTIONS = [1000, 5000, 10000] as const;
export const TERMINAL_LINE_HEIGHT_RANGE = { min: 1, max: 1.6 } as const;

export const DEFAULT_TERMINAL_FONT_FAMILY: TerminalFontFamily = 'sf-mono';
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2;
export const DEFAULT_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'block';
export const DEFAULT_TERMINAL_SCROLLBACK = 1000;
