import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Capability, ConnectionInput, ConnectionRecord, GroupRecord, ProductErrorInfo } from '../shared/ipc.ts';
import { extractFingerprint } from '../shared/fingerprints.ts';
import { ConnectionForm, type FormSecrets } from './components/ConnectionForm.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FilePanel } from './components/FilePanel.tsx';
import { HostKeyDialog, type HostKeyPrompt } from './components/HostKeyDialog.tsx';
import { SessionTree } from './components/SessionTree.tsx';
import { TabBar } from './components/TabBar.tsx';
import { TerminalView } from './components/TerminalView.tsx';

interface Tab {
  id: string;
  title: string;
  capabilities: Capability[];
  connectionId?: string;
}

interface FormState {
  editing: ConnectionRecord | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
}

let localSequence = 0;

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<ProductErrorInfo | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hostKey, setHostKey] = useState<HostKeyPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.eterm.listConnections();
    if (result.ok) {
      setConnections(result.value.connections);
      setGroups(result.value.groups);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addTab = useCallback((tab: Tab): void => {
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }, []);

  const openLocalTerminal = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const result = await window.eterm.openSession({ protocol: 'local', cols: 80, rows: 24 });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      addTab({ id: result.value.sessionId, title: `本地终端 ${++localSequence}`, capabilities: result.value.capabilities });
    } catch (cause) {
      setError({
        code: 'INTERNAL',
        message: '终端没有打开',
        next: '重试一次；仍然失败请重启应用',
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [addTab]);

  const openConnection = useCallback(
    async (connection: ConnectionRecord): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await window.eterm.openConnection({
          connectionId: connection.id,
          cols: 80,
          rows: 24,
        });
        if (!result.ok) {
          const fingerprint = extractFingerprint(result.error.detail ?? '');
          if (result.error.code === 'HOST_KEY_CHANGED' && fingerprint && connection.host) {
            setHostKey({ connection, fingerprint, first: result.error.message.includes('首次') });
            return;
          }
          setError(result.error);
          return;
        }
        addTab({
          id: result.value.sessionId,
          title: connection.name,
          capabilities: result.value.capabilities,
          connectionId: connection.id,
        });
        setFilesOpen(true);
      } finally {
        setBusy(false);
      }
    },
    [addTab],
  );

  const confirmHostKey = useCallback(async (): Promise<void> => {
    if (!hostKey) return;
    const { connection, fingerprint } = hostKey;
    setBusy(true);
    try {
      const saved = await window.eterm.rememberHostKey(connection.host ?? '', connection.port ?? 22, fingerprint);
      if (!saved.ok) {
        setError(saved.error);
        setHostKey(null);
        return;
      }
      setHostKey(null);
      await openConnection(connection);
    } finally {
      setBusy(false);
    }
  }, [hostKey, openConnection]);

  const openNewForm = useCallback((): void => {
    setForm({ editing: null, hasPassword: false, hasPassphrase: false });
    setFormError(null);
  }, []);

  const openEditForm = useCallback(async (connection: ConnectionRecord): Promise<void> => {
    const [password, passphrase] = await Promise.all([
      window.eterm.hasCredential(connection.id, 'password'),
      window.eterm.hasCredential(connection.id, 'passphrase'),
    ]);
    setForm({
      editing: connection,
      hasPassword: password.ok ? password.value : false,
      hasPassphrase: passphrase.ok ? passphrase.value : false,
    });
    setFormError(null);
  }, []);

  const submitForm = useCallback(
    async (input: ConnectionInput, secrets: FormSecrets, connectAfter: boolean): Promise<void> => {
      setSubmitting(true);
      setFormError(null);
      try {
        const saved = await window.eterm.saveConnection(input);
        if (!saved.ok) {
          setFormError(saved.error.message);
          return;
        }

        if (secrets.password) {
          const stored = await window.eterm.setCredential(saved.value.id, 'password', secrets.password);
          if (!stored.ok) {
            setFormError(stored.error.message);
            return;
          }
        }
        if (secrets.passphrase) {
          const stored = await window.eterm.setCredential(saved.value.id, 'passphrase', secrets.passphrase);
          if (!stored.ok) {
            setFormError(stored.error.message);
            return;
          }
        }

        await refresh();
        setForm(null);
        if (connectAfter) await openConnection(saved.value);
      } finally {
        setSubmitting(false);
      }
    },
    [openConnection, refresh],
  );

  const removeConnection = useCallback(
    async (connection: ConnectionRecord): Promise<void> => {
      const confirmed = window.confirm(`删除连接「${connection.name}」？保存的密码也会一起删除。`);
      if (!confirmed) return;

      const result = await window.eterm.deleteConnection(connection.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const addGroup = useCallback(
    async (name: string): Promise<void> => {
      const result = await window.eterm.saveGroup({ name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const reorderConnections = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      const result = await window.eterm.reorderConnections(orderedIds);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        void openLocalTerminal();
      }
      if (key === 'n') {
        event.preventDefault();
        openNewForm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openLocalTerminal, openNewForm]);

  const closeTab = useCallback((id: string): void => {
    void window.eterm.closeSession(id);
    setTabs((current) => current.filter((tab) => tab.id !== id));
  }, []);

  const activeTabId = tabs.some((tab) => tab.id === activeId) ? activeId : (tabs.at(-1)?.id ?? null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeConnectionId = activeTab?.connectionId ?? null;
  const filesAvailable = activeTab?.capabilities.includes('file') === true;

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        filesAvailable={filesAvailable}
        filesOpen={filesOpen}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openLocalTerminal()}
        onToggleFiles={() => setFilesOpen((value) => !value)}
      />
      <div className="app__body">
        <SessionTree
          groups={groups}
          connections={connections}
          activeConnectionId={activeConnectionId}
          query={query}
          onQueryChange={setQuery}
          onConnect={(connection) => void openConnection(connection)}
          onNew={openNewForm}
          onEdit={(connection) => void openEditForm(connection)}
          onDelete={(connection) => void removeConnection(connection)}
          onAddGroup={(name) => void addGroup(name)}
          onReorder={(orderedIds) => void reorderConnections(orderedIds)}
        />
        <main className="workspace">
          {error ? (
            <div className="error-bar">
              <div className="error-bar__body">
                <strong>{error.message}</strong>
                <span>{error.next}</span>
                {error.detail ? (
                  <details className="error-bar__detail">
                    <summary>详情</summary>
                    <pre>{error.detail}</pre>
                  </details>
                ) : null}
              </div>
              <button className="icon-button" type="button" title="关闭" aria-label="关闭错误" onClick={() => setError(null)}>
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          ) : null}
          <div className="workspace__content">
            {tabs.length === 0 ? (
              <EmptyState onNewConnection={openNewForm} onNewTerminal={() => void openLocalTerminal()} />
            ) : (
              tabs.map((tab) => (
                <section className="pane" key={tab.id} data-active={tab.id === activeTabId}>
                  <TerminalView sessionId={tab.id} active={tab.id === activeTabId} />
                </section>
              ))
            )}
          </div>
        </main>
        {filesAvailable && filesOpen && activeTab ? (
          <FilePanel sessionId={activeTab.id} onClose={() => setFilesOpen(false)} />
        ) : null}
      </div>

      {form ? (
        <ConnectionForm
          groups={groups}
          editing={form.editing}
          hasStoredPassword={form.hasPassword}
          hasStoredPassphrase={form.hasPassphrase}
          submitting={submitting}
          error={formError}
          onCancel={() => setForm(null)}
          onSubmit={(input, secrets, connectAfter) => void submitForm(input, secrets, connectAfter)}
        />
      ) : null}

      {hostKey ? (
        <HostKeyDialog prompt={hostKey} busy={busy} onCancel={() => setHostKey(null)} onConfirm={() => void confirmHostKey()} />
      ) : null}
    </div>
  );
}
