interface EmptyStateProps {
  onNewConnection(): void;
  onNewTerminal(): void;
}

export function EmptyState({ onNewConnection, onNewTerminal }: EmptyStateProps) {
  return (
    <div className="empty">
      <h1 className="empty__title">还没有连接</h1>
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
