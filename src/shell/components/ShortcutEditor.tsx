import { useEffect, useState } from 'react';
import { COMMANDS, shortcutLabel, type CommandDefinition, type CommandId } from '../commands/registry.ts';
import { findConflictIds, shortcutFromEvent, type ResolvedShortcuts } from '../commands/resolve.ts';
import type { ShortcutOverrides } from '../../shared/shortcut.ts';

interface ShortcutEditorProps {
  /** 当前生效表（默认 + 覆盖）。 */
  resolved: ResolvedShortcuts;
  overrides: ShortcutOverrides;
  onChange(next: ShortcutOverrides): void;
}

const GROUPS = COMMANDS.reduce<{ group: string; commands: CommandDefinition[] }[]>((list, command) => {
  const existing = list.find((item) => item.group === command.group);
  if (existing) existing.commands.push(command);
  else list.push({ group: command.group, commands: [command] });
  return list;
}, []);

/** 快捷键编辑：点键位进入录制，Esc 取消；冲突行内标出，冲突未解决时不允许保存。 */
export function ShortcutEditor({ resolved, overrides, onChange }: ShortcutEditorProps) {
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const conflicts = findConflictIds(resolved);

  useEffect(() => {
    if (!recording) return;
    // 捕获阶段吃掉按键：不再冒泡到全局分发，也不会触发设置面板的 Esc 关闭。
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setHint(null);
        return;
      }
      const spec = shortcutFromEvent(event);
      if (!spec) {
        setHint('只支持 ⌘ 组合；⌘Q / ⌘H / ⌘M / ⌘Tab 等系统键不可绑定');
        return;
      }
      onChange({ ...overrides, [recording]: spec });
      setRecording(null);
      setHint(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, overrides, onChange]);

  return (
    <div className="shortcut-editor">
      <div className="shortcut-editor__header">
        <p className="form-hint">点快捷键后按下新组合，Esc 取消。只支持 ⌘ 组合，Ctrl 留给终端。</p>
        <button
          className="button"
          type="button"
          data-testid="shortcuts-reset"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => onChange({})}
        >
          恢复默认快捷键
        </button>
      </div>

      {hint ? <p className="form-error" data-testid="shortcut-hint">{hint}</p> : null}
      {conflicts.size > 0 ? (
        <p className="form-error" data-testid="shortcut-conflict">
          有 {conflicts.size} 条快捷键冲突，解决后才能保存。
        </p>
      ) : null}

      {GROUPS.map(({ group, commands }) => (
        <div className="shortcut-group" key={group}>
          <div className="settings-subtitle">{group}</div>
          {commands.map((command) => {
            const spec = resolved[command.id] ?? null;
            const active = recording === command.id;
            return (
              <div className="shortcut-row" key={command.id} data-testid={`shortcut-row-${command.id}`}>
                <span className="shortcut-row__title">{command.title}</span>
                <button
                  className="shortcut-key"
                  type="button"
                  data-active={active}
                  data-conflict={conflicts.has(command.id)}
                  data-testid={`shortcut-edit-${command.id}`}
                  onClick={() => {
                    setHint(null);
                    setRecording(active ? null : command.id);
                  }}
                >
                  {active ? '按下新组合…' : spec ? shortcutLabel(spec) : '未绑定'}
                </button>
                <button
                  className="link-button"
                  type="button"
                  data-testid={`shortcut-clear-${command.id}`}
                  disabled={!spec}
                  onClick={() => onChange({ ...overrides, [command.id]: null })}
                >
                  解绑
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
