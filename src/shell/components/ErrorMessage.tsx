import type { ProductErrorInfo } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';

interface ErrorMessageProps {
  error: ProductErrorInfo;
}

/**
 * 三段式错误：人话 → 下一步 → 折叠详情。
 * 原始英文错误只进 details，界面上永远先给能看懂的原因和下一步。
 */
export function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <div className="error-message" data-testid="error-message" data-code={error.code}>
      <strong className="error-message__title">{error.message}</strong>
      <span className="error-message__next">{error.next}</span>
      {error.detail ? (
        <details className="error-message__detail">
          <summary>{t('error.detail')}</summary>
          <pre>{error.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}
