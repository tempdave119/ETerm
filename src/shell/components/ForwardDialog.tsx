import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ForwardDirection, ForwardView } from '../../shared/ipc.ts';
import { t, type MessageKey } from '../../shared/i18n/index.ts';

interface ForwardDialogProps {
  sessionId: string;
  onClose(): void;
}

const DIRECTION_LABEL: Record<ForwardDirection, MessageKey> = {
  local: 'forward.local',
  remote: 'forward.remote',
};

/** 端口转发挂在当前会话上：关闭会话即释放，不写入配置文件。 */
export function ForwardDialog({ sessionId, onClose }: ForwardDialogProps) {
  const [forwards, setForwards] = useState<ForwardView[]>([]);
  const [direction, setDirection] = useState<ForwardDirection>('local');
  const [bindPort, setBindPort] = useState('8080');
  const [targetHost, setTargetHost] = useState('127.0.0.1');
  const [targetPort, setTargetPort] = useState('80');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.eterm.listForwards(sessionId);
    if (result.ok) setForwards(result.value);
    else setError(result.error.message);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const add = async (): Promise<void> => {
    setError(null);
    const bindPortNumber = Number(bindPort);
    const targetPortNumber = Number(targetPort);
    const minBind = direction === 'local' ? 0 : 1;
    if (!Number.isInteger(bindPortNumber) || bindPortNumber < minBind || bindPortNumber > 65535) {
      setError(t('forward.bindPortInvalid', { min: minBind }));
      return;
    }
    if (!Number.isInteger(targetPortNumber) || targetPortNumber < 1 || targetPortNumber > 65535) {
      setError(t('forward.targetPortInvalid'));
      return;
    }
    if (!targetHost.trim()) {
      setError(t('forward.targetHostRequired'));
      return;
    }

    setBusy(true);
    try {
      const result = await window.eterm.openForward(sessionId, {
        direction,
        bindHost: '127.0.0.1',
        bindPort: bindPortNumber,
        targetHost: targetHost.trim(),
        targetPort: targetPortNumber,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    const result = await window.eterm.closeForward(sessionId, id);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await refresh();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--compact" role="dialog" aria-modal="true" aria-label={t('forward.title')} data-testid="forward-dialog">
        <h2 className="modal__title">{t('forward.title')}</h2>

        <div className="forward-list" data-testid="forward-list">
          {forwards.length === 0 ? (
            <p className="form-hint">{t('forward.emptyHint')}</p>
          ) : (
            forwards.map((item) => (
              <div className="forward-row" key={item.id} data-testid={`forward-row-${item.id}`}>
                <span className="forward-row__direction">{t(DIRECTION_LABEL[item.direction])}</span>
                <span className="forward-row__path">
                  {item.bindHost}:{item.bindPort} → {item.targetHost}:{item.targetPort}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  title={t('forward.stop')}
                  aria-label={t('forward.stop')}
                  data-testid={`forward-close-${item.id}`}
                  onClick={() => void remove(item.id)}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="form-row">
          <label htmlFor="forward-direction">{t('forward.direction')}</label>
          <select
            id="forward-direction"
            data-testid="forward-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as ForwardDirection)}
          >
            <option value="local">{t('forward.localLong')}</option>
            <option value="remote">{t('forward.remoteLong')}</option>
          </select>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="forward-bind-port">{t('forward.bindPort')}</label>
            <input
              id="forward-bind-port"
              data-testid="forward-bind-port"
              value={bindPort}
              inputMode="numeric"
              onChange={(event) => setBindPort(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="forward-target-port">{t('forward.targetPort')}</label>
            <input
              id="forward-target-port"
              data-testid="forward-target-port"
              value={targetPort}
              inputMode="numeric"
              onChange={(event) => setTargetPort(event.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="forward-target-host">{t('forward.targetHost')}</label>
          <input
            id="forward-target-host"
            data-testid="forward-target-host"
            value={targetHost}
            onChange={(event) => setTargetHost(event.target.value)}
          />
        </div>

        <p className="form-hint">
          {direction === 'local' ? t('forward.localHint') : t('forward.remoteHint')}
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal__actions">
          <button className="button" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="forward-add"
            disabled={busy}
            onClick={() => void add()}
          >
            {t('forward.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
