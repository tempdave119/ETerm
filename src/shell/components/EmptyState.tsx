import type { ProductErrorInfo } from '../../shared/ipc.ts';

interface EmptyStateProps {
  error: ProductErrorInfo | null;
  opening: boolean;
  onNew(): void;
}

export function EmptyState({ error, opening, onNew }: EmptyStateProps) {
  if (error) {
    return (
      <div className="empty">
        <h1 className="empty__title">{error.message}</h1>
        <button className="button button--primary" type="button" onClick={onNew} disabled={opening}>
          {opening ? '正在打开…' : '重试'}
        </button>
        <p className="empty__hint">下一步：{error.next}</p>
        {error.detail ? (
          <details className="empty__detail">
            <summary>详情</summary>
            <pre>{error.detail}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className="empty">
      <h1 className="empty__title">还没有连接</h1>
      <button
        className="button button--primary"
        type="button"
        data-testid="new-terminal"
        onClick={onNew}
        disabled={opening}
      >
        {opening ? '正在打开…' : '新建终端'}
      </button>
      <p className="empty__hint">或按 ⌘T</p>
    </div>
  );
}
