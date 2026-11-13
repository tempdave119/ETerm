import type { ConnectionRecord } from '../../shared/ipc.ts';

export interface HostKeyPrompt {
  connection: ConnectionRecord;
  fingerprint: string;
  first: boolean;
}

interface HostKeyDialogProps {
  prompt: HostKeyPrompt;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function HostKeyDialog({ prompt, busy, onCancel, onConfirm }: HostKeyDialogProps) {
  const host = prompt.connection.host ?? '';
  const port = prompt.connection.port ?? 22;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--compact" role="dialog" aria-modal="true" aria-label="确认主机指纹">
        <h2 className="modal__title">{prompt.first ? '首次连接，确认主机指纹' : '主机指纹已变化'}</h2>
        <p className="form-hint">
          {prompt.connection.name} · {host}:{port}
        </p>
        <code className="fingerprint">{prompt.fingerprint}</code>
        <p className="form-hint">
          {prompt.first
            ? '确认这是目标主机后保存，之后连接不再询问。'
            : '可能是主机重装，也可能是中间人劫持。确认无误后再保存新指纹。'}
        </p>
        <div className="modal__actions">
          <button className="button" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="hostkey-trust"
            onClick={onConfirm}
            disabled={busy}
          >
            信任并保存并连接
          </button>
        </div>
      </div>
    </div>
  );
}
