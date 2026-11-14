import { Activity, ArrowLeftRight, Columns2, FolderOpen, Rows2, Settings } from 'lucide-react';
import { t } from '../../shared/i18n/index.ts';

interface TabInfo {
  id: string;
  title: string;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string | null;
  filesAvailable: boolean;
  filesOpen: boolean;
  monitorOpen: boolean;
  forwardAvailable: boolean;
  canSplit: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onToggleFiles(): void;
  onToggleMonitor(): void;
  onOpenForward(): void;
  onSplit(direction: 'row' | 'column'): void;
  onOpenSettings(): void;
}

export function TabBar({
  tabs,
  activeId,
  filesAvailable,
  filesOpen,
  monitorOpen,
  forwardAvailable,
  canSplit,
  onSelect,
  onClose,
  onNew,
  onToggleFiles,
  onToggleMonitor,
  onOpenForward,
  onSplit,
  onOpenSettings,
}: TabBarProps) {
  return (
    <header className="tabbar">
      <div className="tabbar__tabs">
        {tabs.map((tab) => (
          <div className="tab" key={tab.id} data-active={tab.id === activeId}>
            <button className="tab__label" type="button" title={tab.title} onClick={() => onSelect(tab.id)}>
              {tab.title}
            </button>
            <button
              className="tab__close"
              type="button"
              title={t('tab.closeAria', { name: tab.title })}
              aria-label={t('tab.closeAria', { name: tab.title })}
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <span className="tabbar__spacer" />
      <button
        className="tabbar__action"
        type="button"
        title={t('menu.splitRow')}
        aria-label={t('menu.splitRow')}
        data-testid="split-row"
        disabled={!canSplit}
        onClick={() => onSplit('row')}
      >
        <Columns2 size={16} strokeWidth={1.5} />
      </button>
      <button
        className="tabbar__action"
        type="button"
        title={t('menu.splitColumn')}
        aria-label={t('menu.splitColumn')}
        data-testid="split-column"
        disabled={!canSplit}
        onClick={() => onSplit('column')}
      >
        <Rows2 size={16} strokeWidth={1.5} />
      </button>
      {filesAvailable ? (
        <button
          className="tabbar__action"
          type="button"
          data-active={filesOpen}
          title={filesOpen ? t('files.collapse') : t('files.expand')}
          aria-label={filesOpen ? t('files.collapse') : t('files.expand')}
          onClick={onToggleFiles}
        >
          <FolderOpen size={16} strokeWidth={1.5} />
        </button>
      ) : null}
      {forwardAvailable ? (
        <button
          className="tabbar__action"
          type="button"
          title={t('command.forward.open')}
          aria-label={t('command.forward.open')}
          data-testid="open-forwards"
          onClick={onOpenForward}
        >
          <ArrowLeftRight size={16} strokeWidth={1.5} />
        </button>
      ) : null}
      <button
        className="tabbar__action"
        type="button"
        data-active={monitorOpen}
        title={t('panel.monitor')}
        aria-label={t('panel.monitor')}
        data-testid="toggle-monitor"
        onClick={onToggleMonitor}
      >
        <Activity size={16} strokeWidth={1.5} />
      </button>
      <button
        className="tabbar__action"
        type="button"
        title={t('settings.title')}
        aria-label={t('settings.title')}
        data-testid="open-settings"
        onClick={onOpenSettings}
      >
        <Settings size={16} strokeWidth={1.5} />
      </button>
      <button className="tabbar__new" type="button" title={t('menu.newTerminal')} aria-label={t('menu.newTerminal')} onClick={onNew}>
        +
      </button>
    </header>
  );
}
