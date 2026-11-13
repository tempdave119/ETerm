import { useEffect } from 'react';
import { DOCKABLE_PANEL_IDS, panelDockOf, type DockId, type PanelId, type PanelLayout } from '../../shared/panels.ts';
import type { AppConfig, ThemePreference, UiDensity } from '../../shared/ipc.ts';
import { panelById } from '../panels/registry.ts';

interface SettingsPanelProps {
  config: AppConfig;
  error: string | null;
  panelLayout: PanelLayout;
  onChange(next: AppConfig): void;
  onPanelDockChange(id: PanelId, dock: DockId | null): void;
  onReset(): void;
  onClose(): void;
}

const FONT_SIZES = Array.from({ length: 10 }, (_, index) => 11 + index);
const CONCURRENCY = [1, 2, 3, 4];

/** 设置在主窗口内即时生效：每次改动直接提交，不做「保存」按钮。 */
export function SettingsPanel({ config, error, panelLayout, onChange, onPanelDockChange, onReset, onClose }: SettingsPanelProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const update = (patch: (draft: AppConfig) => void): void => {
    const next = structuredClone(config);
    patch(next);
    onChange(next);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--compact" role="dialog" aria-modal="true" aria-label="设置" data-testid="settings-panel">
        <h2 className="modal__title">设置</h2>

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
        </section>

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
          <p className="form-hint">改动立即生效：正在跑的任务不受影响，排队任务按新并发补位。</p>
        </section>

        <section className="settings-group">
          <h3 className="settings-group__title">界面</h3>
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
        </section>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal__actions">
          <button className="button" type="button" data-testid="settings-reset" onClick={onReset}>
            恢复默认
          </button>
          <button className="button button--primary" type="button" data-testid="settings-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
