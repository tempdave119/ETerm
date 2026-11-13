import { ArrowDown, ArrowUp, RotateCcw, X } from 'lucide-react';
import type { TransferView } from '../../shared/ipc.ts';

interface TransferPanelProps {
  tasks: TransferView[];
  onCancel(id: string): void;
  onRetry(id: string): void;
}

const STATUS_LABEL: Record<TransferView['status'], string> = {
  queued: '排队中',
  running: '传输中',
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
};

export function TransferPanel({ tasks, onCancel, onRetry }: TransferPanelProps) {
  return (
    <section className="transfer-panel" data-testid="transfer-panel">
      <header className="transfer-panel__header">
        <span className="transfer-panel__title">传输队列</span>
        <span className="transfer-panel__count">{tasks.length}</span>
      </header>
      <div className="transfer-panel__list">
        {tasks.map((task) => {
          const percent = task.total > 0 ? Math.min(100, Math.round((task.transferred / task.total) * 100)) : 0;
          return (
            <div
              className="transfer-row"
              key={task.id}
              data-testid={`transfer-row-${task.id}`}
              data-status={task.status}
              title={task.error ?? `${task.localPath} → ${task.remotePath}`}
            >
              {task.direction === 'upload' ? (
                <ArrowUp size={14} strokeWidth={1.5} className="transfer-row__icon" />
              ) : (
                <ArrowDown size={14} strokeWidth={1.5} className="transfer-row__icon" />
              )}
              <span className="transfer-row__name">{task.name}</span>
              <span className="transfer-row__status">{STATUS_LABEL[task.status]}</span>
              <span className="transfer-row__bar">
                <span className="transfer-row__bar-fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="transfer-row__meta">
                {task.total > 0 ? `${percent}%` : `${task.transferred} B`}
              </span>
              {task.status === 'running' || task.status === 'queued' ? (
                <button
                  className="icon-button"
                  type="button"
                  title="取消传输"
                  aria-label="取消传输"
                  onClick={() => onCancel(task.id)}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              ) : null}
              {task.status === 'failed' || task.status === 'canceled' ? (
                <button
                  className="icon-button"
                  type="button"
                  title="重试"
                  aria-label="重试"
                  onClick={() => onRetry(task.id)}
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
