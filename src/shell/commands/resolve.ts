/**
 * 快捷键解析：注册表默认值 + 用户覆盖 = 当前生效表。
 * 冲突检测只看生效值，解绑（null）的项不参与；⌘W 与 ⌘⇧W 视为不同组合。
 */

import {
  RESERVED_CODES,
  isSameShortcut,
  resolveShortcuts,
  shortcutKey,
  type ResolvedShortcuts,
  type ShortcutSpec,
} from '../../shared/shortcut.ts';
import { COMMANDS, matchesShortcut, type CommandDefinition, type CommandId, type KeyEventLike } from './registry.ts';

export { resolveShortcuts };
export type { ResolvedShortcuts };

/** 单条冲突查询：返回占用同一组合的其他命令，没有则 null。 */
export function findConflict(
  id: string,
  spec: ShortcutSpec | null,
  resolved: ResolvedShortcuts,
): CommandId | null {
  if (!spec) return null;
  for (const [otherId, other] of Object.entries(resolved)) {
    if (otherId === id || !other) continue;
    if (isSameShortcut(spec, other)) return otherId as CommandId;
  }
  return null;
}

/** 返回所有与其他命令撞车的命令 id，用于行内提示与禁用保存。 */
export function findConflictIds(resolved: ResolvedShortcuts): Set<string> {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const [id, spec] of Object.entries(resolved)) {
    if (!spec) continue;
    const key = shortcutKey(spec);
    const other = seen.get(key);
    if (other) {
      conflicts.add(id);
      conflicts.add(other);
    } else {
      seen.set(key, id);
    }
  }
  return conflicts;
}

/** 录制：只接受 ⌘ 组合，且避开系统保留键（⌘Q / ⌘H / ⌘M 等）。 */
export function shortcutFromEvent(event: KeyEventLike): ShortcutSpec | null {
  if (!event.metaKey || event.altKey || event.ctrlKey) return null;
  if (RESERVED_CODES.has(event.code)) return null;
  return event.shiftKey ? { code: event.code, shift: true } : { code: event.code };
}

export function findCommandByShortcut(
  event: KeyEventLike,
  resolved: ResolvedShortcuts,
  commands: readonly CommandDefinition[] = COMMANDS,
): CommandDefinition | null {
  for (const command of commands) {
    const spec = resolved[command.id];
    if (spec && matchesShortcut(event, spec)) return command;
  }
  return null;
}
