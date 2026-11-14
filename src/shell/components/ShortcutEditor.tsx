import { useEffect, useMemo, useState } from 'react';
import {
  commandGroup,
  commandTitle,
  shortcutLabel,
  type CommandDefinition,
} from '../commands/registry.ts';
import { findConflictIds, shortcutFromEvent, type ResolvedShortcuts } from '../commands/resolve.ts';
import { t } from '../../shared/i18n/index.ts';
import type { ShortcutOverrides } from '../../shared/shortcut.ts';

interface ShortcutEditorProps {
  /** 内置 + 插件命令的合并表。 */
  commands: readonly CommandDefinition[];
  /** 当前生效表（默认 + 覆盖）。 */
  resolved: ResolvedShortcuts;
  overrides: ShortcutOverrides;
  onChange(next: ShortcutOverrides): void;
}

/** 快捷键编辑：点键位进入录制，Esc 取消；冲突行内标出，冲突未解决时不允许保存。 */
export function ShortcutEditor({ commands, resolved, overrides, onChange }: ShortcutEditorProps) {
  const [recording, setRecording] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const conflicts = findConflictIds(resolved);

  const groups = useMemo(() => {
    const list: { key: string; title: string; commands: CommandDefinition[] }[] = [];
    for (const command of commands) {
      const key = command.groupKey ?? 'plugin';
      const existing = list.find((item) => item.key === key);
      if (existing) existing.commands.push(command);
      else list.push({ key, title: commandGroup(command), commands: [command] });
    }
    return list;
  }, [commands]);

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
        setHint(t('settings.shortcuts.invalid'));
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
        <p className="form-hint">{t('settings.shortcuts.hint')}</p>
        <button
          className="button"
          type="button"
          data-testid="shortcuts-reset"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => onChange({})}
        >
          {t('settings.shortcuts.reset')}
        </button>
      </div>

      {hint ? <p className="form-error" data-testid="shortcut-hint">{hint}</p> : null}
      {conflicts.size > 0 ? (
        <p className="form-error" data-testid="shortcut-conflict">
          {t('settings.shortcuts.conflict', { count: conflicts.size })}
        </p>
      ) : null}

      {groups.map(({ key, title, commands: groupCommands }) => (
        <div className="shortcut-group" key={key}>
          <div className="settings-subtitle">{title}</div>
          {groupCommands.map((command) => {
            const spec = resolved[command.id] ?? null;
            const active = recording === command.id;
            return (
              <div className="shortcut-row" key={command.id} data-testid={`shortcut-row-${command.id}`}>
                <span className="shortcut-row__title">{commandTitle(command)}</span>
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
                  {active ? t('settings.shortcuts.recording') : spec ? shortcutLabel(spec) : t('settings.shortcuts.unbound')}
                </button>
                <button
                  className="link-button"
                  type="button"
                  data-testid={`shortcut-clear-${command.id}`}
                  disabled={!spec}
                  onClick={() => onChange({ ...overrides, [command.id]: null })}
                >
                  {t('settings.shortcuts.unbind')}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}