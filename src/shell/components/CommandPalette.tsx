import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  commandGroup,
  commandTitle,
  filterCommands,
  shortcutLabel,
  type CommandDefinition,
} from '../commands/registry.ts';

interface CommandPaletteProps {
  commands: readonly CommandDefinition[];
  onRun(id: string): void;
  onClose(): void;
}

/** ⌘K 命令面板：搜索、方向键、Enter 执行、Esc 关闭。 */
export function CommandPalette({ commands, onRun, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterCommands(query, commands), [query, commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const run = (index: number): void => {
    const command = results[index];
    if (!command) return;
    onRun(command.id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(activeIndex);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        data-testid="command-palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          id="command-query"
          className="palette__input"
          data-testid="command-query"
          placeholder="输入命令名称，回车执行"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette__list">
          {results.length === 0 ? (
            <div className="palette__empty">没有匹配的命令</div>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                className="palette__item"
                type="button"
                data-active={index === activeIndex}
                data-testid={`command-${command.id}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(index)}
              >
                <span className="palette__title">{commandTitle(command)}</span>
                <span className="palette__group">{commandGroup(command)}</span>
                {command.shortcut ? (
                  <span className="palette__shortcut">{shortcutLabel(command.shortcut)}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}