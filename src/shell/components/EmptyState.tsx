import type { ProductErrorInfo } from '../../shared/ipc.ts';
import { ErrorMessage } from './ErrorMessage.tsx';

interface EmptyStateProps {
  error: ProductErrorInfo | null;
  onNewConnection(): void;
  onNewTerminal(): void;
}

export function EmptyState({ error, onNewConnection, onNewTerminal }: EmptyStateProps) {
  return (
    <div className="empty">
      <h1 className="empty__title">{error ? '连接没有建立' : '还没有连接'}</h1>
      {error ? (
        <div className="empty__error">
          <ErrorMessage error={error} />
        </div>
      ) : null}
      <button
        className="button button--primary"
        type="button"
        data-testid="new-connection"
        onClick={onNewConnection}
      >
        新建连接
      </button>
      <p className="empty__hint">
        或
        <button className="link-button" type="button" data-testid="new-terminal" onClick={onNewTerminal}>
          打开本地终端
        </button>
        （⌘T）
      </p>
    </div>
  );
}
