import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.ts';

interface LocalShellDialogProps {
  onCancel(): void;
  onSubmit(command: string): void;
}

/** 一次性的本地 shell 覆盖：只影响本次新建，不写回设置。 */
export function LocalShellDialog({ onCancel, onSubmit }: LocalShellDialogProps) {
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const submit = (): void => {
    const value = command.trim();
    if (!value) {
      setError(t('localShell.required'));
      return;
    }
    onSubmit(value);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal modal--compact"
        role="dialog"
        aria-modal="true"
        aria-label={t('localShell.title')}
        data-testid="local-shell-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal__title">{t('localShell.title')}</h2>
        <div className="form-row">
          <label htmlFor="local-shell-command">{t('localShell.command')}</label>
          <input
            ref={inputRef}
            id="local-shell-command"
            data-testid="local-shell-command"
            value={command}
            maxLength={200}
            placeholder={t('localShell.placeholder')}
            onChange={(event) => {
              setCommand(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </div>
        <p className="form-hint">{t('localShell.hint')}</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button className="button" type="button" onClick={onCancel}>
            {t('localShell.cancel')}
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="local-shell-submit"
            onClick={submit}
          >
            {t('localShell.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
