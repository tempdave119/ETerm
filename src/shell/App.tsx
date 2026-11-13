import { useCallback, useEffect, useState } from 'react';
import type { ProductErrorInfo } from '../shared/ipc.ts';
import { EmptyState } from './components/EmptyState.tsx';
import { TabBar } from './components/TabBar.tsx';
import { TerminalView } from './components/TerminalView.tsx';

interface Tab {
  id: string;
  title: string;
}

let sequence = 0;

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<ProductErrorInfo | null>(null);
  const [opening, setOpening] = useState(false);

  const openTerminal = useCallback(async (): Promise<void> => {
    setOpening(true);
    setError(null);
    try {
      const result = await window.eterm.openSession({ protocol: 'local', cols: 80, rows: 24 });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const tab: Tab = { id: result.value.sessionId, title: `本地终端 ${++sequence}` };
      setTabs((current) => [...current, tab]);
      setActiveId(tab.id);
    } catch (cause) {
      setError({
        code: 'INTERNAL',
        message: '终端没有打开',
        next: '重试一次；仍然失败请重启应用',
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      void openTerminal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openTerminal]);

  const closeTab = useCallback((id: string): void => {
    void window.eterm.closeSession(id);
    setTabs((current) => current.filter((tab) => tab.id !== id));
  }, []);

  // 活动标签只由 tabs 推导，关闭后自动落到最后一个，不用额外同步一份状态。
  const activeTabId = tabs.some((tab) => tab.id === activeId) ? activeId : (tabs.at(-1)?.id ?? null);

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openTerminal()}
      />
      <main className="workspace">
        {tabs.length === 0 ? (
          <EmptyState error={error} opening={opening} onNew={() => void openTerminal()} />
        ) : (
          tabs.map((tab) => (
            <section className="pane" key={tab.id} data-active={tab.id === activeTabId}>
              <TerminalView sessionId={tab.id} active={tab.id === activeTabId} />
            </section>
          ))
        )}
      </main>
    </div>
  );
}
