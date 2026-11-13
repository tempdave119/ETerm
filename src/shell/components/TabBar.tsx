interface TabInfo {
  id: string;
  title: string;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
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
      <button className="tabbar__new" type="button" title="新建终端" aria-label="新建终端" onClick={onNew}>
        +
      </button>
    </header>
  );
}
