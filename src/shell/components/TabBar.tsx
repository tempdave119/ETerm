import { FolderOpen } from 'lucide-react';

interface TabInfo {
  id: string;
  title: string;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string | null;
  filesAvailable: boolean;
  filesOpen: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onToggleFiles(): void;
}

export function TabBar({
  tabs,
  activeId,
  filesAvailable,
  filesOpen,
  onSelect,
  onClose,
  onNew,
  onToggleFiles,
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
      <button className="tabbar__new" type="button" title="新建终端" aria-label="新建终端" onClick={onNew}>
        +
      </button>
    </header>
  );
}
