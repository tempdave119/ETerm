import { useEffect } from 'react';
import type { AppConfig, UiDensity } from '../../shared/ipc.ts';

interface SettingsPanelProps {
  config: AppConfig;
  error: string | null;
  onChange(next: AppConfig): void;
  onReset(): void;
  onClose(): void;
}

const FONT_SIZES = Array.from({ length: 10 }, (_, index) => 11 + index);
const CONCURRENCY = [1, 2, 3, 4];

/** 设置在主窗口内即时生效：每次改动直接提交，不做「保存」按钮。 */
export function SettingsPanel({ config, error, onChange, onReset, onClose }: SettingsPanelProps) {
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
