import { ArrowDown, ArrowUp, RotateCcw, X } from 'lucide-react';
import type { DockId } from '../../shared/panels.ts';
import type { TransferView } from '../../shared/ipc.ts';
import { ErrorMessage } from './ErrorMessage.tsx';
import { PanelFrame } from './PanelFrame.tsx';

interface TransferPanelProps {
  tasks: TransferView[];
  dock: DockId | null;
  onMove(target: DockId | null): void;
  onCancel(id: string): void;
  onRetry(id: string): void;
  onOpenFiles(): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

const STATUS_LABEL: Record<TransferView['status'], string> = {
  queued: '排队中',
  running: '传输中',
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
};

export function TransferPanel({
  tasks,
  dock,
  onMove,
  onCancel,
  onRetry,
  onOpenFiles,
  canPanelMoveUp,
  canPanelMoveDown,
  onPanelReorder,
}: TransferPanelProps) {
  return (
    <PanelFrame
      panelId="transfers"
      title="传输队列"
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
      actions={<span className="transfer-panel__count">{tasks.length}</span>}
    >
      <div className="transfer-panel__list">
        {tasks.length === 0 ? (
          <div className="panel-empty panel-empty--stacked" data-testid="transfer-empty">
            <p className="panel-empty__title">还没有传输任务</p>
            <button
              className="button"
              type="button"
              data-testid="transfer-open-files"
              onClick={onOpenFiles}
            >
              打开文件面板
            </button>
            <p className="panel-empty__hint">在文件面板选择上传或下载后，任务会出现在这里</p>
          </div>
        ) : null}
        {tasks.map((task) => {
          const percent = task.total > 0 ? Math.min(100, Math.round((task.transferred / task.total) * 100)) : 0;
          return (
            <div className="transfer-item" key={task.id}>
              <div
                className="transfer-row"
                data-testid={`transfer-row-${task.id}`}
                data-status={task.status}
                title={`${task.localPath} → ${task.remotePath}`}
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
              {task.error ? (
                <div className="transfer-error">
                  <ErrorMessage error={task.error} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </PanelFrame>
  );
}
