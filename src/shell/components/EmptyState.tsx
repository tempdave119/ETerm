import type { ProductErrorInfo } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { ErrorMessage } from './ErrorMessage.tsx';

interface EmptyStateProps {
  error: ProductErrorInfo | null;
  onNewConnection(): void;
  onNewTerminal(): void;
}

export function EmptyState({ error, onNewConnection, onNewTerminal }: EmptyStateProps) {
  return (
    <div className="empty">
      <h1 className="empty__title">{error ? t('empty.notConnected') : t('tree.empty')}</h1>
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
        {t('empty.newConnection')}
      </button>
      <p className="empty__hint">
        {t('empty.or')}
        <button className="link-button" type="button" data-testid="new-terminal" onClick={onNewTerminal}>
          {t('empty.newTerminal')}
        </button>
      </p>
    </div>
  );
}
