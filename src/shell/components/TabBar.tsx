import { Activity, Columns2, FolderOpen, Rows2, Settings } from 'lucide-react';

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
  canSplit: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onToggleFiles(): void;
  onToggleMonitor(): void;
  onSplit(direction: 'row' | 'column'): void;
  onOpenSettings(): void;
}

export function TabBar({
  tabs,
  activeId,
  filesAvailable,
  filesOpen,
  monitorOpen,
  canSplit,
  onSelect,
  onClose,
  onNew,
  onToggleFiles,
  onToggleMonitor,
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
              title={`关闭 ${tab.title}`}
              aria-label={`关闭 ${tab.title}`}
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
        title="左右分屏（⌘D）"
        aria-label="左右分屏"
        data-testid="split-row"
        disabled={!canSplit}
        onClick={() => onSplit('row')}
      >
        <Columns2 size={16} strokeWidth={1.5} />
      </button>
      <button
        className="tabbar__action"
        type="button"
        title="上下分屏（⌘⇧D）"
        aria-label="上下分屏"
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
          title={filesOpen ? '收起文件面板' : '展开文件面板'}
          aria-label={filesOpen ? '收起文件面板' : '展开文件面板'}
          onClick={onToggleFiles}
        >
          <FolderOpen size={16} strokeWidth={1.5} />
        </button>
      ) : null}
      <button
        className="tabbar__action"
        type="button"
        data-active={monitorOpen}
        title="系统资源（⌘⇧M）"
        aria-label="系统资源"
        data-testid="toggle-monitor"
        onClick={onToggleMonitor}
      >
        <Activity size={16} strokeWidth={1.5} />
      </button>
      <button
        className="tabbar__action"
        type="button"
        title="设置（⌘,）"
        aria-label="设置"
        data-testid="open-settings"
        onClick={onOpenSettings}
      >
        <Settings size={16} strokeWidth={1.5} />
      </button>
      <button className="tabbar__new" type="button" title="新建终端" aria-label="新建终端" onClick={onNew}>
        +
      </button>
    </header>
  );
}
