import { ArrowDown, ArrowUp, RotateCcw, X } from 'lucide-react';
import type { DockId } from '../../shared/panels.ts';
import type { TransferView } from '../../shared/ipc.ts';
import { t, type MessageKey } from '../../shared/i18n/index.ts';
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

const STATUS_LABEL: Record<TransferView['status'], MessageKey> = {
  queued: 'transfer.queued',
  running: 'transfer.running',
  done: 'transfer.done',
  failed: 'transfer.failed',
  canceled: 'transfer.cancelled',
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
      title={t('panel.transfers')}
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
            <p className="panel-empty__title">{t('transfer.empty')}</p>
            <button
              className="button"
              type="button"
              data-testid="transfer-open-files"
              onClick={onOpenFiles}
            >
              {t('transfer.openFiles')}
            </button>
            <p className="panel-empty__hint">{t('transfer.emptyHint')}</p>
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
                <span className="transfer-row__status">{t(STATUS_LABEL[task.status])}</span>
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
                    title={t('transfer.cancel')}
                    aria-label={t('transfer.cancel')}
                    data-testid={`transfer-cancel-${task.id}`}
                    onClick={() => onCancel(task.id)}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                ) : null}
                {task.status === 'failed' || task.status === 'canceled' ? (
                  <button
                    className="icon-button"
                    type="button"
                    title={t('transfer.retry')}
                    aria-label={t('transfer.retry')}
                    data-testid={`transfer-retry-${task.id}`}
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
