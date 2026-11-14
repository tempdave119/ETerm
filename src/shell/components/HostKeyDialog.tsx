import type { ConnectionRecord } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';

export interface HostKeyPrompt {
  connection: ConnectionRecord;
  fingerprint: string;
  first: boolean;
  /** 失败的那一跳，可能是跳板机而不是目标主机。 */
  host: string;
  port: number;
}

interface HostKeyDialogProps {
  prompt: HostKeyPrompt;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function HostKeyDialog({ prompt, busy, onCancel, onConfirm }: HostKeyDialogProps) {
  const viaJump = prompt.host !== prompt.connection.host || prompt.port !== (prompt.connection.port ?? 22);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--compact" role="dialog" aria-modal="true" aria-label={t('hostKey.title')}>
        <h2 className="modal__title">
          {prompt.first ? t('hostKey.firstTitle') : t('hostKey.changedTitle')}
        </h2>
        <p className="form-hint">
          {prompt.connection.name} · {prompt.host}:{prompt.port}
        </p>
        <code className="fingerprint">{prompt.fingerprint}</code>
        <p className="form-hint">
          {prompt.first ? t('hostKey.firstHint') : t('hostKey.changedHint')}
        </p>
        {viaJump ? <p className="form-hint">{t('hostKey.viaJumpHint')}</p> : null}
        <div className="modal__actions">
          <button className="button" type="button" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="hostkey-trust"
            onClick={onConfirm}
            disabled={busy}
          >
            {t('hostKey.trust')}
          </button>
        </div>
      </div>
    </div>
  );
}
