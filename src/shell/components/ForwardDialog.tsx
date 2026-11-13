import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ForwardDirection, ForwardView } from '../../shared/ipc.ts';

interface ForwardDialogProps {
  sessionId: string;
  onClose(): void;
}

const DIRECTION_LABEL: Record<ForwardDirection, string> = {
  local: '本地转发',
  remote: '远程转发',
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
      setError(`监听端口必须是 ${minBind}–65535 的整数`);
      return;
    }
    if (!Number.isInteger(targetPortNumber) || targetPortNumber < 1 || targetPortNumber > 65535) {
      setError('目标端口必须是 1–65535 的整数');
      return;
    }
    if (!targetHost.trim()) {
      setError('请填写目标主机');
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
      <div className="modal modal--compact" role="dialog" aria-modal="true" aria-label="端口转发" data-testid="forward-dialog">
        <h2 className="modal__title">端口转发</h2>

        <div className="forward-list" data-testid="forward-list">
          {forwards.length === 0 ? (
            <p className="form-hint">这个会话还没有转发规则。</p>
          ) : (
            forwards.map((item) => (
              <div className="forward-row" key={item.id} data-testid={`forward-row-${item.id}`}>
                <span className="forward-row__direction">{DIRECTION_LABEL[item.direction]}</span>
                <span className="forward-row__path">
                  {item.bindHost}:{item.bindPort} → {item.targetHost}:{item.targetPort}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  title="停止转发"
                  aria-label="停止转发"
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
          <label htmlFor="forward-direction">方向</label>
          <select
            id="forward-direction"
            data-testid="forward-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as ForwardDirection)}
          >
            <option value="local">本地转发（本机监听 → 远端目标）</option>
            <option value="remote">远程转发（远端监听 → 本机目标）</option>
          </select>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="forward-bind-port">监听端口</label>
            <input
              id="forward-bind-port"
              data-testid="forward-bind-port"
              value={bindPort}
              inputMode="numeric"
              onChange={(event) => setBindPort(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="forward-target-port">目标端口</label>
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
          <label htmlFor="forward-target-host">目标主机</label>
          <input
            id="forward-target-host"
            data-testid="forward-target-host"
            value={targetHost}
            onChange={(event) => setTargetHost(event.target.value)}
          />
        </div>

        <p className="form-hint">
          {direction === 'local'
            ? '监听地址固定 127.0.0.1；监听端口填 0 由系统分配。'
            : '在服务器侧监听 127.0.0.1，需要服务器允许端口转发。'}
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal__actions">
          <button className="button" type="button" onClick={onClose}>
            关闭
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="forward-add"
            disabled={busy}
            onClick={() => void add()}
          >
            添加转发
          </button>
        </div>
      </div>
    </div>
  );
}
