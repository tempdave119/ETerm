import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCK_SIZE_LIMITS, DOCKABLE_PANEL_IDS, panelDockOf, type DockId, type PanelId, type PanelLayout } from '../../shared/panels.ts';
import { defaultConfig, type AppConfig, type LanguagePreference, type ThemePreference, type UiDensity } from '../../shared/ipc.ts';
import type { ComponentDescriptor, ComponentSample } from '../../shared/components.ts';
import { commandForShellPreset, detectShellPreset, type LocalShellPreset } from '../../shared/local-shell.ts';
import type { ThemeDefinition } from '../../shared/theme.ts';
import { panelById } from '../panels/registry.ts';
import { findConflictIds, resolveShortcuts } from '../commands/resolve.ts';
import { t, type MessageKey } from '../../shared/i18n/index.ts';
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
  themes: ThemeDefinition[];
  onReloadThemes(): void;
  onOpenThemesDir(): void;
  components: ComponentDescriptor[];
  componentSamples: ComponentSample[];
  componentsBusy: boolean;
  componentsNotice: string | null;
  onInstallComponentSamples(): void;
  onOpenComponentsDir(): void;
}

type SectionId = 'appearance' | 'terminal' | 'connection' | 'extensions' | 'transfer' | 'shortcuts' | 'layout';

const SECTIONS: { id: SectionId; titleKey: MessageKey }[] = [
  { id: 'appearance', titleKey: 'settings.nav.appearance' },
  { id: 'terminal', titleKey: 'settings.nav.terminal' },
  { id: 'connection', titleKey: 'settings.nav.connection' },
  { id: 'extensions', titleKey: 'settings.nav.extensions' },
  { id: 'transfer', titleKey: 'settings.nav.transfer' },
  { id: 'shortcuts', titleKey: 'settings.nav.shortcuts' },
  { id: 'layout', titleKey: 'settings.nav.layout' },
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
  themes,
  onReloadThemes,
  onOpenThemesDir,
  components,
  componentSamples,
  componentsBusy,
  componentsNotice,
  onInstallComponentSamples,
  onOpenComponentsDir,
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
  const selectedExternalId = config.ui.theme.startsWith('ext:') ? config.ui.theme.slice(4) : null;
  const selectedExternalMissing = Boolean(
    selectedExternalId && !themes.some((theme) => theme.id === selectedExternalId),
  );
  const loadedComponentIds = new Set(components.map((component) => component.id));
  const localShellPreset = detectShellPreset(config.terminal.localCommand);

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
        <h2 className="modal__title">{t('settings.title')}</h2>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t('settings.title')}>
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-nav__item"
                data-active={section === item.id}
                data-testid={`settings-nav-${item.id}`}
                onClick={() => setSection(item.id)}
              >
                {t(item.titleKey)}
              </button>
            ))}
          </nav>

          <div className="settings-panel__body" data-testid="settings-body">
            {section === 'appearance' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.appearance')}</h3>
                <div className="form-row">
                  <label htmlFor="settings-language">{t('settings.language')}</label>
                  <select
                    id="settings-language"
                    data-testid="settings-language"
                    value={config.ui.language}
                    onChange={(event) =>
                      update((draft) => {
                        draft.ui.language = event.target.value as LanguagePreference;
                      })
                    }
                  >
                    <option value="system">{t('settings.language.system')}</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
                <p className="form-hint">{t('settings.languageHint')}</p>
                <div className="form-row">
                  <label htmlFor="settings-theme">{t('settings.theme')}</label>
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
                    <option value="system">{t('settings.theme.system')}</option>
                    <option value="dark">{t('settings.theme.dark')}</option>
                    <option value="light">{t('settings.theme.light')}</option>
                    {themes.map((theme) => (
                      <option key={theme.id} value={`ext:${theme.id}`}>
                        {theme.name}
                      </option>
                    ))}
                    {selectedExternalMissing ? (
                      <option value={config.ui.theme}>{t('settings.theme.missing')}</option>
                    ) : null}
                  </select>
                </div>
                <div className="form-row">
                  <span />
                  <div className="settings-theme-actions">
                    <button className="button" type="button" onClick={onReloadThemes} data-testid="settings-theme-reload">
                      {t('settings.theme.reload')}
                    </button>
                    <button className="button" type="button" onClick={onOpenThemesDir} data-testid="settings-theme-open-dir">
                      {t('settings.theme.openDir')}
                    </button>
                  </div>
                </div>
                {selectedExternalMissing ? (
                  <p className="form-hint form-hint--warning">{t('settings.theme.missingHint')}</p>
                ) : null}
                <div className="form-row">
                  <label htmlFor="settings-density">{t('settings.density')}</label>
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
                    <option value="comfortable">{t('settings.density.comfortable')}</option>
                    <option value="compact">{t('settings.density.compact')}</option>
                  </select>
                </div>
                <p className="form-hint">{t('settings.appearanceHint')}</p>
              </section>
            ) : null}

            {section === 'terminal' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.terminal')}</h3>
                <div className="form-row">
                  <label htmlFor="settings-font-size">{t('settings.fontSize')}</label>
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
                  <label htmlFor="settings-local-shell">{t('settings.localShell')}</label>
                  <select
                    id="settings-local-shell"
                    data-testid="settings-local-shell"
                    value={localShellPreset}
                    onChange={(event) => {
                      const preset = event.target.value as LocalShellPreset;
                      update((draft) => {
                        draft.terminal.localCommand = commandForShellPreset(preset);
                      });
                    }}
                  >
                    <option value="system">{t('settings.localShell.system')}</option>
                    <option value="zsh">zsh -l</option>
                    <option value="bash">bash -l</option>
                    <option value="sh">sh -l</option>
                    <option value="custom">{t('settings.localShell.custom')}</option>
                  </select>
                </div>
                {localShellPreset === 'custom' ? (
                  <div className="form-row">
                    <label htmlFor="settings-local-command">{t('settings.localCommand')}</label>
                    <input
                      id="settings-local-command"
                      data-testid="settings-local-command"
                      value={config.terminal.localCommand}
                      maxLength={200}
                      placeholder={t('settings.localCommandPlaceholder')}
                      onChange={(event) =>
                        update((draft) => {
                          draft.terminal.localCommand = event.target.value;
                        })
                      }
                    />
                  </div>
                ) : null}
                <p className="form-hint">{t('settings.localCommandHint')}</p>
                <div className="form-row">
                  <label htmlFor="settings-right-click">{t('settings.rightClick')}</label>
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
                    <option value="paste">{t('settings.rightClick.paste')}</option>
                    <option value="menu">{t('settings.rightClick.menu')}</option>
                    <option value="off">{t('settings.rightClick.off')}</option>
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
                  {t('settings.rightClickCopy')}
                </label>
              </section>
            ) : null}

            {section === 'connection' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.connection')}</h3>
                <div className="form-row">
                  <label htmlFor="settings-keepalive">{t('settings.keepalive')}</label>
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
                        {seconds < 60 ? t('common.seconds', { count: seconds }) : t('common.minutes', { count: seconds / 60 })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="settings-keepalive-count">{t('settings.keepaliveCount')}</label>
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
                        {t('common.times', { count })}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="form-hint">{t('settings.keepaliveHint')}</p>
              </section>
            ) : null}

            {section === 'extensions' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.extensions')}</h3>
                <p className="form-hint">{t('settings.extensions.intro')}</p>
                <p className="form-hint">{t('settings.extensions.builtin')}</p>
                <h4 className="settings-subtitle">{t('settings.extensions.samples')}</h4>
                {componentSamples.length === 0 ? (
                  <p className="form-hint">{t('settings.extensions.empty')}</p>
                ) : (
                  <div className="component-sample-list">
                    {componentSamples.map((sample) => {
                      const loaded = loadedComponentIds.has(sample.id);
                      const status = !sample.installed
                        ? t('settings.extensions.notInstalled')
                        : loaded
                          ? t('settings.extensions.installed')
                          : t('settings.extensions.pendingRestart');
                      return (
                        <div
                          className="component-sample"
                          key={sample.id}
                          data-testid={`component-sample-${sample.id}`}
                          data-installed={sample.installed}
                          data-loaded={loaded}
                        >
                          <span className="component-sample__name">{sample.label}</span>
                          <span className="component-sample__protocol">{sample.protocol}</span>
                          <span className="component-sample__status">{status}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="settings-theme-actions">
                  <button
                    className="button"
                    type="button"
                    data-testid="components-install"
                    disabled={componentsBusy}
                    onClick={onInstallComponentSamples}
                  >
                    {t('settings.extensions.install')}
                  </button>
                  <button
                    className="button"
                    type="button"
                    data-testid="components-open-dir"
                    onClick={onOpenComponentsDir}
                  >
                    {t('settings.extensions.openDir')}
                  </button>
                </div>
                <p className="form-hint">{t('settings.extensions.restartHint')}</p>
                {componentsNotice ? <p className="form-hint">{componentsNotice}</p> : null}
              </section>
            ) : null}

            {section === 'transfer' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.transfer')}</h3>
                <div className="form-row">
                  <label htmlFor="settings-concurrency">{t('settings.concurrency')}</label>
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
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="form-hint">{t('settings.concurrencyHint')}</p>
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
                  {t('settings.filesDefault')}
                </label>
              </section>
            ) : null}

            {section === 'shortcuts' ? (
              <section className="settings-group">
                <h3 className="settings-group__title">{t('settings.nav.shortcuts')}</h3>
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
                <h3 className="settings-group__title">{t('settings.nav.layout')}</h3>
                {DOCKABLE_PANEL_IDS.map((id) => {
                  const panel = panelById(id);
                  return (
                    <div className="form-row" key={id}>
                      <label htmlFor={`settings-dock-${id}`}>{panel ? t(panel.titleKey) : id}</label>
                      <select
                        id={`settings-dock-${id}`}
                        data-testid={`settings-dock-${id}`}
                        value={panelDockOf(panelLayout, id) ?? 'closed'}
                        onChange={(event) => {
                          const value = event.target.value;
                          onPanelDockChange(id, value === 'closed' ? null : (value as DockId));
                        }}
                      >
                        <option value="left">{t('panel.dock.left')}</option>
                        <option value="right">{t('panel.dock.right')}</option>
                        <option value="bottom">{t('panel.dock.bottom')}</option>
                        <option value="closed">{t('settings.rightClick.off')}</option>
                      </select>
                    </div>
                  );
                })}
                <div className="settings-subtitle">{t('settings.dockSize')}</div>
                {(['left', 'right', 'bottom'] as const).map((dock) => {
                  const limit = DOCK_SIZE_LIMITS[dock];
                  const label =
                    dock === 'left'
                      ? t('settings.leftWidth')
                      : dock === 'right'
                        ? t('settings.rightWidth')
                        : t('settings.bottomHeight');
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
                        <span className="settings-range__value">{t('common.px', { count: value })}</span>
                      </div>
                    </div>
                  );
                })}
                <p className="form-hint">{t('settings.layoutHint')}</p>
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
              {confirming === 'settings' ? t('settings.confirmAgain') : t('settings.reset')}
            </button>
            <button
              className="button"
              type="button"
              data-testid="settings-reset-layout"
              onClick={() => confirmThen('layout', onResetLayout)}
            >
              {confirming === 'layout' ? t('settings.confirmAgain') : t('settings.resetLayout')}
            </button>
          </div>
          <div className="settings-footer__group">
            <button className="button" type="button" data-testid="settings-cancel" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              className="button button--primary"
              type="button"
              data-testid="settings-save"
              disabled={(!dirty && !error) || shortcutConflicts.size > 0}
              onClick={onSave}
            >
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
