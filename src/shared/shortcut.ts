/**
 * 快捷键契约：主进程菜单与渲染层键盘分发共用。
 * code 用 KeyboardEvent.code，不受中文输入法与 Shift 后符号变化影响；
 * 只支持 ⌘ 组合（Ctrl 留给终端），shift 作为区分位。
 */

import { COMMANDS } from './commands.ts';

export interface ShortcutSpec {
  /** KeyboardEvent.code，例如 KeyT / Comma / BracketLeft。 */
  code: string;
  shift?: boolean;
}

/** 只记录与注册表默认值的差异；null 表示显式解绑。 */
export type ShortcutOverrides = Record<string, ShortcutSpec | null>;

export type ResolvedShortcuts = Record<string, ShortcutSpec | null>;

/** 合并默认值与用户覆盖；解绑的项保持 null，不参与分发与冲突检测。 */
export function resolveShortcuts(overrides: ShortcutOverrides): ResolvedShortcuts {
  const resolved: ResolvedShortcuts = {};
  for (const command of COMMANDS) {
    const override = overrides[command.id];
    resolved[command.id] = override === undefined ? (command.shortcut ?? null) : override;
  }
  return resolved;
}

/** macOS 与系统约定占用的组合，不允许绑定到产品命令。 */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['KeyQ', 'KeyH', 'KeyM', 'Tab', 'Space']);

export function isSameShortcut(a: ShortcutSpec | null, b: ShortcutSpec | null): boolean {
  if (!a || !b) return a === b;
  return a.code === b.code && Boolean(a.shift) === Boolean(b.shift);
}

/** 冲突判定用的稳定键：⌘W 与 ⌘⇧W 是不同组合。 */
export function shortcutKey(spec: ShortcutSpec): string {
  return `${spec.code}|${spec.shift ? 'shift' : ''}`;
}
