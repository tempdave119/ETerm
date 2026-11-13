import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type {
  AppConfig,
  ConnectionInput,
  ConnectionRecord,
  GroupRecord,
  ProductErrorInfo,
  TransferView,
} from '../shared/ipc.ts';
import { extractFingerprint } from '../shared/fingerprints.ts';
import { countTemplateLeaves } from '../shared/layout-template.ts';
import {
  clampRatio,
  collectLeaves,
  countLeaves,
  findLeaf,
  firstLeaf,
  instantiateLayout,
  removeAt,
  setRatioAt,
  splitAt,
  toTemplate,
  type LayoutNode,
  type PaneLeaf,
  type SplitDirection,
} from './layout.ts';
import { ConnectionForm, type FormSecrets } from './components/ConnectionForm.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { FilePanel } from './components/FilePanel.tsx';
import { HostKeyDialog, type HostKeyPrompt } from './components/HostKeyDialog.tsx';
import { PaneLayout } from './components/PaneLayout.tsx';
import { SessionTree } from './components/SessionTree.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { TabBar } from './components/TabBar.tsx';
import { TransferPanel } from './components/TransferPanel.tsx';

interface Tab {
  id: string;
  title: string;
  connectionId?: string;
  layout: LayoutNode;
  activePaneId: string;
}

interface FormState {
  editing: ConnectionRecord | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
}

let localSequence = 0;
let tabSequence = 0;
let paneSequence = 0;
let splitSequence = 0;

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
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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

  useEffect(() => {
    void window.eterm.getConfig().then((result) => {
      if (result.ok) setConfig(result.value);
      else setError(result.error);
    });
    return window.eterm.onConfigChange(setConfig);
  }, []);

  useEffect(() => {
    void window.eterm.listTransfers().then((result) => {
      if (result.ok) setTransfers(result.value);
    });
    return window.eterm.onTransferUpdate((task) => {
      setTransfers((current) => {
        const index = current.findIndex((item) => item.id === task.id);
        if (index < 0) return [...current, task];
        const next = [...current];
        next[index] = task;
        return next;
      });
    });
  }, []);

  const cancelTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.cancelTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const retryTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.retryTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const saveConfig = useCallback(async (next: AppConfig): Promise<void> => {
    setSettingsError(null);
    const result = await window.eterm.saveConfig(next);
    if (result.ok) setConfig(result.value);
    else setSettingsError(result.error.message);
  }, []);

  const resetConfig = useCallback(async (): Promise<void> => {
    setSettingsError(null);
    const result = await window.eterm.resetConfig();
    if (result.ok) setConfig(result.value);
    else setSettingsError(result.error.message);
  }, []);

  const openSettings = useCallback((): void => {
    setSettingsError(null);
    setSettingsOpen(true);
  }, []);

  const activeTabId = tabs.some((tab) => tab.id === activeId) ? activeId : (tabs.at(-1)?.id ?? null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activePane = activeTab ? (findLeaf(activeTab.layout, activeTab.activePaneId) ?? firstLeaf(activeTab.layout)) : null;
  const activeConnectionId = activePane?.connectionId ?? null;
  const filesAvailable = activePane?.capabilities.includes('file') === true;

  const addTab = useCallback((tab: Tab): void => {
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }, []);

  const loadLayout = useCallback(async (key: string) => {
    const result = await window.eterm.getLayout(key);
    return result.ok ? result.value : null;
  }, []);

  const persistLayout = useCallback(async (key: string, layout: LayoutNode): Promise<void> => {
    const result = await window.eterm.saveLayout(key, toTemplate(layout));
    if (!result.ok) setError(result.error);
  }, []);

  const openLocalTerminal = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const template = await loadLayout('local');
      const count = template ? countTemplateLeaves(template) : 1;
      const leaves: PaneLeaf[] = [];

      for (let index = 0; index < count; index += 1) {
        const result = await window.eterm.openSession({ protocol: 'local', cols: 80, rows: 24 });
        if (!result.ok) {
          for (const leaf of leaves) void window.eterm.closeSession(leaf.sessionId);
          setError(result.error);
          return;
        }
        leaves.push({
          type: 'leaf',
          paneId: `pane-${++paneSequence}`,
          sessionId: result.value.sessionId,
          title: `本地终端 ${++localSequence}`,
          capabilities: result.value.capabilities,
        });
      }

      const first = leaves[0];
      if (!first) return;
      const layout = template
        ? instantiateLayout(template, leaves, () => `split-${++splitSequence}`)
        : first;
      addTab({ id: `tab-${++tabSequence}`, title: first.title, layout, activePaneId: firstLeaf(layout).paneId });
    } catch (cause) {
      setError({
        code: 'INTERNAL',
        message: '终端没有打开',
        next: '重试一次；仍然失败请重启应用',
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [addTab, loadLayout]);

  const openConnection = useCallback(
    async (connection: ConnectionRecord): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const template = await loadLayout(connection.id);
        const count = template ? countTemplateLeaves(template) : 1;
        const leaves: PaneLeaf[] = [];

        for (let index = 0; index < count; index += 1) {
          const result = await window.eterm.openConnection({
            connectionId: connection.id,
            cols: 80,
            rows: 24,
          });
          if (!result.ok) {
            for (const leaf of leaves) void window.eterm.closeSession(leaf.sessionId);
            const fingerprint = extractFingerprint(result.error.detail ?? '');
            if (leaves.length === 0 && result.error.code === 'HOST_KEY_CHANGED' && fingerprint && connection.host) {
              setHostKey({ connection, fingerprint, first: result.error.message.includes('首次') });
              return;
            }
            setError(result.error);
            return;
          }
          leaves.push({
            type: 'leaf',
            paneId: `pane-${++paneSequence}`,
            sessionId: result.value.sessionId,
            title: connection.name,
            capabilities: result.value.capabilities,
            connectionId: connection.id,
          });
        }

        const first = leaves[0];
        if (!first) return;
        const layout = template
          ? instantiateLayout(template, leaves, () => `split-${++splitSequence}`)
          : first;
        addTab({
          id: `tab-${++tabSequence}`,
          title: connection.name,
          connectionId: connection.id,
          layout,
          activePaneId: firstLeaf(layout).paneId,
        });
        setFilesOpen(config?.files.openByDefault ?? true);
      } finally {
        setBusy(false);
      }
    },
    [addTab, config, loadLayout],
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

  const splitActivePane = useCallback(
    async (direction: SplitDirection): Promise<void> => {
      const tab = activeTab;
      if (!tab || countLeaves(tab.layout) >= 4) return;

      setError(null);
      const result = tab.connectionId
        ? await window.eterm.openConnection({ connectionId: tab.connectionId, cols: 80, rows: 24 })
        : await window.eterm.openSession({ protocol: 'local', cols: 80, rows: 24 });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const title = tab.connectionId ? tab.title : `本地终端 ${++localSequence}`;
      const leaf: PaneLeaf = {
        type: 'leaf',
        paneId: `pane-${++paneSequence}`,
        sessionId: result.value.sessionId,
        title,
        capabilities: result.value.capabilities,
        connectionId: tab.connectionId,
      };

      const layout = splitAt(tab.layout, tab.activePaneId, leaf, direction, `split-${++splitSequence}`);
      setTabs((current) =>
        current.map((item) =>
          item.id === tab.id ? { ...item, layout, activePaneId: leaf.paneId } : item,
        ),
      );
      void persistLayout(tab.connectionId ?? 'local', layout);
      setFilesOpen(config?.files.openByDefault ?? true);
    },
    [activeTab, config, persistLayout],
  );

  const resizePane = useCallback((tabId: string, splitId: string, ratio: number): void => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId ? { ...tab, layout: setRatioAt(tab.layout, splitId, ratio) } : tab,
      ),
    );
  }, []);

  const finishResize = useCallback(
    (tabId: string, splitId: string, ratio: number): void => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) return;
      // 松手才落盘：拖动过程中的比例只存在内存里。
      const layout = setRatioAt(tab.layout, splitId, clampRatio(ratio));
      setTabs((current) => current.map((item) => (item.id === tabId ? { ...item, layout } : item)));
      void persistLayout(tab.connectionId ?? 'local', layout);
    },
    [persistLayout, tabs],
  );

  const setPaneActive = useCallback((tabId: string, paneId: string): void => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, activePaneId: paneId } : tab)));
  }, []);

  const closePane = useCallback(
    (tabId: string, paneId: string): void => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) return;
      const leaf = findLeaf(tab.layout, paneId);
      if (!leaf) return;

      void window.eterm.closeSession(leaf.sessionId);
      const leaves = collectLeaves(tab.layout);
      if (leaves.length <= 1) {
        setTabs((current) => current.filter((item) => item.id !== tabId));
        return;
      }

      const layout = removeAt(tab.layout, paneId);
      if (!layout) {
        setTabs((current) => current.filter((item) => item.id !== tabId));
        return;
      }
      const nextActive = tab.activePaneId === paneId ? firstLeaf(layout).paneId : tab.activePaneId;
      setTabs((current) =>
        current.map((item) => (item.id === tabId ? { ...item, layout, activePaneId: nextActive } : item)),
      );
      void persistLayout(tab.connectionId ?? 'local', layout);
    },
    [persistLayout, tabs],
  );

  const closeTab = useCallback(
    (id: string): void => {
      const tab = tabs.find((item) => item.id === id);
      if (tab) {
        for (const leaf of collectLeaves(tab.layout)) void window.eterm.closeSession(leaf.sessionId);
      }
      setTabs((current) => current.filter((item) => item.id !== id));
    },
    [tabs],
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
      if (key === 'd') {
        event.preventDefault();
        void splitActivePane(event.shiftKey ? 'column' : 'row');
      }
      if (key === ',') {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openLocalTerminal, openNewForm, openSettings, splitActivePane]);

  const canSplit = activeTab ? countLeaves(activeTab.layout) < 4 : false;
  const fontSize = config?.terminal.fontSize ?? 13;
  const density = config?.ui.density ?? 'comfortable';

  return (
    <div className="app" data-density={density}>
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        filesAvailable={filesAvailable}
        filesOpen={filesOpen}
        canSplit={canSplit}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openLocalTerminal()}
        onToggleFiles={() => setFilesOpen((value) => !value)}
        onSplit={(direction) => void splitActivePane(direction)}
        onOpenSettings={openSettings}
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
          {error && tabs.length > 0 ? (
            <div className="error-bar" data-testid="error-bar">
              <ErrorMessage error={error} />
              <button className="icon-button" type="button" title="关闭" aria-label="关闭错误" onClick={() => setError(null)}>
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          ) : null}
          <div className="workspace__content">
            {tabs.length === 0 ? (
              <EmptyState
                error={error}
                onNewConnection={openNewForm}
                onNewTerminal={() => void openLocalTerminal()}
              />
            ) : (
              tabs.map((tab) => (
                <section className="pane" key={tab.id} data-active={tab.id === activeTabId}>
                  <PaneLayout
                    node={tab.layout}
                    activePaneId={tab.activePaneId}
                    tabActive={tab.id === activeTabId}
                    showHeaders={countLeaves(tab.layout) > 1}
                    fontSize={fontSize}
                    onActivate={(paneId) => setPaneActive(tab.id, paneId)}
                    onClose={(paneId) => closePane(tab.id, paneId)}
                    onResize={(splitId, ratio) => resizePane(tab.id, splitId, ratio)}
                    onResizeEnd={(splitId, ratio) => finishResize(tab.id, splitId, ratio)}
                  />
                </section>
              ))
            )}
          </div>
          {transfers.length > 0 ? (
            <TransferPanel
              tasks={transfers}
              onCancel={(id) => void cancelTransfer(id)}
              onRetry={(id) => void retryTransfer(id)}
            />
          ) : null}
        </main>
        {filesAvailable && filesOpen && activePane ? (
          <FilePanel sessionId={activePane.sessionId} onClose={() => setFilesOpen(false)} />
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

      {settingsOpen && config ? (
        <SettingsPanel
          config={config}
          error={settingsError}
          onChange={(next) => void saveConfig(next)}
          onReset={() => void resetConfig()}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
