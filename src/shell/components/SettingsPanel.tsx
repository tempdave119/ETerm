import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCK_SIZE_LIMITS, DOCKABLE_PANEL_IDS, panelDockOf, type DockId, type PanelId, type PanelLayout } from '../../shared/panels.ts';
import { defaultConfig, type AppConfig, type ThemePreference, type UiDensity } from '../../shared/ipc.ts';
import { panelById } from '../panels/registry.ts';
import { findConflictIds, resolveShortcuts } from '../commands/resolve.ts';
import { ShortcutEditor } from './ShortcutEditor.tsx';
import { isDirty } from '../settings-draft.ts';

interface SettingsPanelProps {
  /** 草稿：面板内所有改动只写这里，保存才落盘。 */
  config: AppConfig;
  /** 已保存配置，用于判断是否有未保存改动。 */
  savedConfig: AppConfig;
  error: string | null;
  panelLayout: PanelLayout;
  onChange(next: AppConfig): void;
  onSave(): void;
  onCancel(): void;
  onResetLayout(): void;
  onPanelDockChange(id: PanelId, dock: DockId | null): void;
  onDockSizeChange(dock: 'left' | 'right' | 'bottom', size: number): void;
}

type SectionId = 'appearance' | 'terminal' | 'connection' | 'transfer' | 'shortcuts' | 'layout';

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'appearance', title: '外观' },
  { id: 'terminal', title: '终端' },
  { id: 'connection', title: '连接' },
  { id: 'transfer', title: '传输' },
  { id: 'shortcuts', title: '快捷键' },
  { id: 'layout', title: '面板布局' },
];

const FONT_SIZES = Array.from({ length: 10 }, (_, index) => 11 + index);
const CONCURRENCY = [1, 2, 3, 4];
const KEEPALIVE_INTERVALS = [10, 30, 60, 120, 300];
const KEEPALIVE_COUNTS = [1, 2, 3, 4, 5];

/** 设置分成两类：config 走草稿保存，layout（停靠与尺寸）仍然即时生效。 */
export function SettingsPanel({
  config,
  savedConfig,
  error,
  panelLayout,
  onChange,
  onSave,
  onCancel,
  onResetLayout,
  onPanelDockChange,
  onDockSizeChange,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SectionId>('appearance');
  // 恢复默认是破坏性动作，用「再点一次确认」替代额外弹窗。
  const [confirming, setConfirming] = useState<'settings' | 'layout' | null>(null);
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const update = useCallback(
    (patch: (draft: AppConfig) => void): void => {
      const next = structuredClone(configRef.current);
      patch(next);
      configRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const dirty = isDirty(config, savedConfig);
  const shortcutConflicts = findConflictIds(resolveShortcuts(config.shortcuts.overrides));

  const confirmThen = (kind: 'settings' | 'layout', run: () => void): void => {
    if (confirming !== kind) {
      setConfirming(kind);
      return;
    }
    setConfirming(null);
    run();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--settings" role="dialog" aria-modal="true" aria-label="设置" data-testid="settings-panel">
        <h2 className="modal__title">设置</h2>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-nav__item"
                data-active={section === item.id}
                data-testid={`settings-nav-${item.id}`}
                onClick={() => setSection(item.id)}
              >
                {item.title}
              </button>
            ))}
          </nav>

          <div className="settings-panel__body" data-testid="settings-body">
            {section === 'appearance' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">外观</h3>
                <div className="form-row">
                  <label htmlFor="settings-theme">主题</label>
                  <select
                    id="settings-theme"
                    data-testid="settings-theme"
                    value={config.ui.theme}
                    onChange={(event) =>
                      update((draft) => {
                        draft.ui.theme = event.target.value as ThemePreference;
                      })
                    }
                  >
                    <option value="system">跟随系统</option>
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="settings-density">密度</label>
                  <select
                    id="settings-density"
                    data-testid="settings-density"
                    value={config.ui.density}
                    onChange={(event) =>
                      update((draft) => {
                        draft.ui.density = event.target.value as UiDensity;
                      })
                    }
                  >
                    <option value="comfortable">舒适</option>
                    <option value="compact">紧凑</option>
                  </select>
                </div>
                <p className="form-hint">主题与密度改动即时预览，点「保存」才写入配置。</p>
              </section>
            ) : null}

            {section === 'terminal' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">终端</h3>
                <div className="form-row">
                  <label htmlFor="settings-font-size">字号</label>
                  <select
                    id="settings-font-size"
                    data-testid="settings-font-size"
                    value={config.terminal.fontSize}
                    onChange={(event) =>
                      update((draft) => {
                        draft.terminal.fontSize = Number(event.target.value);
                      })
                    }
                  >
                    {FONT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="settings-right-click">右键点击</label>
                  <select
                    id="settings-right-click"
                    data-testid="settings-right-click"
                    value={config.terminal.rightClick}
                    onChange={(event) =>
                      update((draft) => {
                        draft.terminal.rightClick = event.target.value as AppConfig['terminal']['rightClick'];
                      })
                    }
                  >
                    <option value="paste">粘贴</option>
                    <option value="menu">右键菜单</option>
                    <option value="off">关闭</option>
                  </select>
                </div>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    data-testid="settings-right-click-copy"
                    checked={config.terminal.rightClickCopySelection}
                    disabled={config.terminal.rightClick !== 'paste'}
                    onChange={(event) =>
                      update((draft) => {
                        draft.terminal.rightClickCopySelection = event.target.checked;
                      })
                    }
                  />
                  有选中内容时复制，否则粘贴
                </label>
              </section>
            ) : null}

            {section === 'connection' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">连接</h3>
                <div className="form-row">
                  <label htmlFor="settings-keepalive">保活间隔</label>
                  <select
                    id="settings-keepalive"
                    data-testid="settings-keepalive"
                    value={config.ssh.keepaliveInterval}
                    onChange={(event) =>
                      update((draft) => {
                        draft.ssh.keepaliveInterval = Number(event.target.value);
                      })
                    }
                  >
                    {KEEPALIVE_INTERVALS.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="settings-keepalive-count">无响应重试</label>
                  <select
                    id="settings-keepalive-count"
                    data-testid="settings-keepalive-count"
                    value={config.ssh.keepaliveCountMax}
                    onChange={(event) =>
                      update((draft) => {
                        draft.ssh.keepaliveCountMax = Number(event.target.value);
                      })
                    }
                  >
                    {KEEPALIVE_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count} 次
                      </option>
                    ))}
                  </select>
                </div>
                <p className="form-hint">每 N 秒发一次保活请求；连续无响应达到上限才断开。对新连接生效。</p>
              </section>
            ) : null}

            {section === 'transfer' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">传输</h3>
                <div className="form-row">
                  <label htmlFor="settings-concurrency">同时传输</label>
                  <select
                    id="settings-concurrency"
                    data-testid="settings-concurrency"
                    value={config.transfer.concurrency}
                    onChange={(event) =>
                      update((draft) => {
                        draft.transfer.concurrency = Number(event.target.value);
                      })
                    }
                  >
                    {CONCURRENCY.map((value) => (
                      <option key={value} value={value}>
                        {value} 个
                      </option>
                    ))}
                  </select>
                </div>
                <p className="form-hint">保存后立即生效：正在跑的任务不受影响，排队任务按新并发补位。</p>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    data-testid="settings-files-default"
                    checked={config.files.openByDefault}
                    onChange={(event) =>
                      update((draft) => {
                        draft.files.openByDefault = event.target.checked;
                      })
                    }
                  />
                  连接时默认展开文件面板
                </label>
              </section>
            ) : null}

            {section === 'shortcuts' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">快捷键</h3>
                <ShortcutEditor
                  resolved={resolveShortcuts(config.shortcuts.overrides)}
                  overrides={config.shortcuts.overrides}
                  onChange={(next) =>
                    update((draft) => {
                      draft.shortcuts.overrides = next;
                    })
                  }
                />
              </section>
            ) : null}

            {section === 'layout' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">面板布局</h3>
                {DOCKABLE_PANEL_IDS.map((id) => (
                  <div className="form-row" key={id}>
                    <label htmlFor={`settings-dock-${id}`}>{panelById(id)?.title ?? id}</label>
                    <select
                      id={`settings-dock-${id}`}
                      data-testid={`settings-dock-${id}`}
                      value={panelDockOf(panelLayout, id) ?? 'closed'}
                      onChange={(event) => {
                        const value = event.target.value;
                        onPanelDockChange(id, value === 'closed' ? null : (value as DockId));
                      }}
                    >
                      <option value="left">左侧</option>
                      <option value="right">右侧</option>
                      <option value="bottom">底部</option>
                      <option value="closed">关闭</option>
                    </select>
                  </div>
                ))}
                <div className="settings-subtitle">停靠区尺寸</div>
                {(['left', 'right', 'bottom'] as const).map((dock) => {
                  const limit = DOCK_SIZE_LIMITS[dock];
                  const label = dock === 'left' ? '左栏宽度' : dock === 'right' ? '右栏宽度' : '底栏高度';
                  const value = panelLayout.sizes[dock];
                  return (
                    <div className="form-row" key={dock}>
                      <label htmlFor={`settings-dock-size-${dock}`}>{label}</label>
                      <div className="settings-range">
                        <input
                          id={`settings-dock-size-${dock}`}
                          data-testid={`settings-dock-size-${dock}`}
                          type="range"
                          min={limit.min}
                          max={limit.max}
                          step={1}
                          value={value}
                          onChange={(event) => onDockSizeChange(dock, Number(event.target.value))}
                        />
                        <span className="settings-range__value">{value} px</span>
                      </div>
                    </div>
                  );
                })}
                <p className="form-hint">布局改动即时生效并写入 layout.json，不参与设置草稿。</p>
              </section>
            ) : null}
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="settings-footer">
          <div className="settings-footer__group">
            <button
              className="button"
              type="button"
              data-testid="settings-reset"
              onClick={() =>
                confirmThen('settings', () => {
                  // 只替换草稿，点保存才落盘；取消可完整回滚。
                  configRef.current = defaultConfig();
                  onChange(configRef.current);
                })
              }
            >
              {confirming === 'settings' ? '再点一次确认' : '恢复默认设置'}
            </button>
            <button
              className="button"
              type="button"
              data-testid="settings-reset-layout"
              onClick={() => confirmThen('layout', onResetLayout)}
            >
              {confirming === 'layout' ? '再点一次确认' : '恢复默认布局'}
            </button>
          </div>
          <div className="settings-footer__group">
            <button className="button" type="button" data-testid="settings-cancel" onClick={onCancel}>
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              data-testid="settings-save"
              disabled={(!dirty && !error) || shortcutConflicts.size > 0}
              onClick={onSave}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
