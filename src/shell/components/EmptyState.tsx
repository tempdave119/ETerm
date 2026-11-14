import type { ProductErrorInfo } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { ErrorMessage } from './ErrorMessage.tsx';

interface EmptyStateProps {
  error: ProductErrorInfo | null;
  /** 首次启动引导：无连接且未读过引导时展示；错误态优先显示错误。 */
  showGuide: boolean;
  onNewConnection(): void;
  onNewTerminal(): void;
  onOpenSettings(): void;
  onDismissGuide(): void;
}

export function EmptyState({
  error,
  showGuide,
  onNewConnection,
  onNewTerminal,
  onOpenSettings,
  onDismissGuide,
}: EmptyStateProps) {
  if (showGuide && !error) {
    return (
      <div className="empty empty--guide" data-testid="onboarding-guide">
        <h1 className="empty__title">{t('empty.guideTitle')}</h1>
        <p className="empty__guide-hint">{t('empty.guideHint')}</p>
        <div className="empty__actions">
          <button
            className="button button--primary"
            type="button"
            data-testid="new-connection"
            onClick={onNewConnection}
          >
            {t('empty.newConnection')}
          </button>
          <button className="button" type="button" data-testid="new-terminal" onClick={onNewTerminal}>
            {t('empty.newTerminal')}
          </button>
          <button className="button" type="button" data-testid="guide-settings" onClick={onOpenSettings}>
            {t('empty.guideSettings')}
          </button>
        </div>
        <button className="link-button" type="button" data-testid="guide-dismiss" onClick={onDismissGuide}>
          {t('empty.guideDismiss')}
        </button>
      </div>
    );
  }

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
