import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type {
  AppConfig,
  ComponentDescriptor,
  ConnectionInput,
  ConnectionRecord,
  GroupRecord,
  ProductErrorInfo,
  TransferView,
} from '../shared/ipc.ts';
import { extractFingerprint } from '../shared/fingerprints.ts';
import { countTemplateLeaves } from '../shared/layout-template.ts';
import { defaultPanelLayout, isPanelOpen, movePanel, movePanelWithinDock, panelDockOf, setDivider, type DockId, type PanelId, type PanelLayout } from '../shared/panels.ts';
import {
  clampRatio,
  collectLeaves,
  countLeaves,
  findLeaf,
  firstLeaf,
  instantiateLayout,
  removeAt,
  replaceLeafSession,
  setRatioAt,
  splitAt,
  toTemplate,
  type LayoutNode,
  type PaneLeaf,
  type SplitDirection,
} from './layout.ts';
import { findCommandByShortcut, type CommandId } from './commands/registry.ts';
import { panelById, panelsInDock } from './panels/registry.ts';
import { ConnectionForm, type FormSecrets } from './components/ConnectionForm.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { FilePanel } from './components/FilePanel.tsx';
import { ForwardDialog } from './components/ForwardDialog.tsx';
import { HostKeyDialog, type HostKeyPrompt } from './components/HostKeyDialog.tsx';
import { MonitorPanel } from './components/MonitorPanel.tsx';
import { PaneLayout } from './components/PaneLayout.tsx';
import { SessionTree } from './components/SessionTree.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { DockColumn } from './components/DockColumn.tsx';
import { PanelFrame } from './components/PanelFrame.tsx';
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

const RECONNECT_MAX = 3;

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const plannedClosuresRef = useRef<Set<string>>(new Set());
  const reconnectTimersRef = useRef<Map<string, number>>(new Map());
  const [reconnectNotice, setReconnectNotice] = useState<{ tabId: string; paneId: string; attempt: number } | null>(
    null,
  );
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<ProductErrorInfo | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hostKey, setHostKey] = useState<HostKeyPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  // state 更新要等下一次渲染，同一帧内连点拦不住，所以用 ref 做互斥锁。
  const connectingRef = useRef<string | null>(null);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(defaultPanelLayout);
  // 拖动分隔时用 ref 拿最新布局，避开闭包里的旧值。
  const panelLayoutRef = useRef<PanelLayout>(defaultPanelLayout());
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  // 同步保存最新配置：同一帧内连续切换排序时，后一次要基于前一次的值。
  const configRef = useRef<AppConfig | null>(null);
  // 配置保存要串行：连续改设置时，后一次保存必须基于前一次的结果，不能互相覆盖。
  const configQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingConfigSaves = useRef(0);
  const configVersionRef = useRef(0);
  const [components, setComponents] = useState<ComponentDescriptor[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

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
      if (result.ok) {
        configRef.current = result.value;
        setConfig(result.value);
      } else setError(result.error);
    });
    return window.eterm.onConfigChange((next) => {
      // 本地还有未完成的保存时忽略广播，避免旧广播覆盖刚改的值。
      if (pendingConfigSaves.current > 0) return;
      configRef.current = next;
      setConfig(next);
    });
  }, []);

  useEffect(() => {
    void window.eterm.getPanelLayout().then((result) => {
      if (!result.ok) return;
      panelLayoutRef.current = result.value;
      setPanelLayout(result.value);
    });
  }, []);

  useEffect(() => {
    void window.eterm.listComponents().then((result) => {
      if (result.ok) setComponents(result.value);
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
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

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const cancelReconnect = useCallback((paneId: string): void => {
    const timer = reconnectTimersRef.current.get(paneId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      reconnectTimersRef.current.delete(paneId);
    }
    setReconnectNotice((current) => (current?.paneId === paneId ? null : current));
  }, []);

  const scheduleReconnect = useCallback(
    (tabId: string, paneId: string, connectionId: string, attempt: number): void => {
      if (reconnectTimersRef.current.has(paneId)) return;
      setReconnectNotice({ tabId, paneId, attempt });
      const timer = window.setTimeout(() => {
        reconnectTimersRef.current.delete(paneId);
        void (async () => {
          const currentTab = tabsRef.current.find((item) => item.id === tabId);
          const leaf = currentTab ? findLeaf(currentTab.layout, paneId) : null;
          if (!currentTab || !leaf) return;

          const result = await window.eterm.openConnection({ connectionId, cols: 80, rows: 24 });
          if (result.ok) {
            const latestTab = tabsRef.current.find((item) => item.id === tabId);
            const latestLeaf = latestTab ? findLeaf(latestTab.layout, paneId) : null;
            if (!latestTab || !latestLeaf) {
              void window.eterm.closeSession(result.value.sessionId);
              return;
            }
            setTabs((current) =>
              current.map((item) =>
                item.id === tabId
                  ? {
                      ...item,
                      layout: replaceLeafSession(
                        item.layout,
                        paneId,
                        result.value.sessionId,
                        result.value.capabilities,
                      ),
                    }
                  : item,
              ),
            );
            setReconnectNotice(null);
            setError(null);
            return;
          }

          if (attempt < RECONNECT_MAX) {
            scheduleReconnect(tabId, paneId, connectionId, attempt + 1);
          } else {
            setReconnectNotice(null);
            setError(result.error);
          }
        })();
      }, Math.min(8000, 1000 * 2 ** (attempt - 1)));
      reconnectTimersRef.current.set(paneId, timer);
    },
    [],
  );

  const closeSessionPlanned = useCallback((sessionId: string): void => {
    plannedClosuresRef.current.add(sessionId);
    window.setTimeout(() => plannedClosuresRef.current.delete(sessionId), 5000);
    void window.eterm.closeSession(sessionId);
  }, []);

  useEffect(() => {
    return window.eterm.onSessionExit((sessionId, info) => {
      if (plannedClosuresRef.current.delete(sessionId)) return;
      if (info.reason !== 'network') return;
      const tab = tabsRef.current.find((item) =>
        collectLeaves(item.layout).some((leaf) => leaf.sessionId === sessionId),
      );
      if (!tab?.connectionId) return;
      const leaf = collectLeaves(tab.layout).find((item) => item.sessionId === sessionId);
      if (!leaf) return;
      scheduleReconnect(tab.id, leaf.paneId, tab.connectionId, 1);
    });
  }, [scheduleReconnect]);

  useEffect(
    () => () => {
      for (const timer of reconnectTimersRef.current.values()) window.clearTimeout(timer);
      reconnectTimersRef.current.clear();
    },
    [],
  );

  const cancelTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.cancelTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const retryTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.retryTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const saveConfig = useCallback((next: AppConfig): void => {
    setSettingsError(null);
    // 乐观更新，下一次设置改动基于最新值克隆；保存本身串行执行。
    const version = ++configVersionRef.current;
    configRef.current = next;
    setConfig(next);
    pendingConfigSaves.current += 1;
    configQueueRef.current = configQueueRef.current
      .then(async () => {
        const result = await window.eterm.saveConfig(next);
        // 只接受最后一次改动的返回值，旧响应不能覆盖新值。
        if (result.ok && version === configVersionRef.current) {
          configRef.current = result.value;
          setConfig(result.value);
        } else if (!result.ok) setSettingsError(result.error.message);
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : '保存配置失败');
      })
      .finally(() => {
        pendingConfigSaves.current -= 1;
      });
  }, []);

  const changeProcessSort = useCallback(
    (sort: AppConfig['ui']['monitorProcessSort']): void => {
      const current = configRef.current;
      if (!current || current.ui.monitorProcessSort === sort) return;
      saveConfig({ ...current, ui: { ...current.ui, monitorProcessSort: sort } });
    },
    [saveConfig],
  );

  const resetConfig = useCallback((): void => {
    setSettingsError(null);
    const version = ++configVersionRef.current;
    pendingConfigSaves.current += 1;
    configQueueRef.current = configQueueRef.current
      .then(async () => {
        const result = await window.eterm.resetConfig();
        if (result.ok && version === configVersionRef.current) {
          configRef.current = result.value;
          setConfig(result.value);
        } else if (!result.ok) setSettingsError(result.error.message);
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : '重置配置失败');
      })
      .finally(() => {
        pendingConfigSaves.current -= 1;
      });
  }, []);

  const openSettings = useCallback((): void => {
    setSettingsError(null);
    setSettingsOpen(true);
  }, []);

  const applyPanelLayout = useCallback((next: PanelLayout, persist: boolean): void => {
    panelLayoutRef.current = next;
    setPanelLayout(next);
    if (!persist) return;
    void window.eterm.savePanelLayout(next).then((result) => {
      if (!result.ok) console.warn(`[panels] 保存面板状态失败：${result.error.message}`);
    });
  }, []);

  const togglePanel = useCallback(
    (id: PanelId): void => {
      const current = panelLayoutRef.current;
      if (panelDockOf(current, id)) {
        applyPanelLayout(movePanel(current, id, null), true);
        return;
      }
      const defaultDock = panelById(id)?.defaultDock;
      applyPanelLayout(movePanel(current, id, defaultDock && defaultDock !== 'overlay' ? defaultDock : 'right'), true);
    },
    [applyPanelLayout],
  );

  const movePanelTo = useCallback(
    (id: PanelId, target: DockId | null): void => {
      applyPanelLayout(movePanel(panelLayoutRef.current, id, target), true);
    },
    [applyPanelLayout],
  );

  const movePanelOrder = useCallback(
    (id: PanelId, delta: -1 | 1): void => {
      const current = panelLayoutRef.current;
      const dock = panelDockOf(current, id);
      if (!dock) return;
      applyPanelLayout(movePanelWithinDock(current, dock, id, delta), true);
    },
    [applyPanelLayout],
  );

  const resizePanelDivider = useCallback(
    (dock: DockId, index: number, ratio: number): void => {
      applyPanelLayout(setDivider(panelLayoutRef.current, dock, index, ratio), false);
    },
    [applyPanelLayout],
  );

  const finishPanelDivider = useCallback(
    (dock: DockId, index: number, ratio: number): void => {
      applyPanelLayout(setDivider(panelLayoutRef.current, dock, index, ratio), true);
    },
    [applyPanelLayout],
  );

  /**
   * 打开连接后按配置自动展开文件面板；关掉时只表示「不自动展开」，
   * 不会强制关闭用户手动打开的面板（显隐以布局为准）。
   */
  const applyFilesDefault = useCallback((): void => {
    if (!(config?.files.openByDefault ?? true)) return;
    const current = panelLayoutRef.current;
    if (!panelDockOf(current, 'files')) applyPanelLayout(movePanel(current, 'files', 'right'), true);
  }, [applyPanelLayout, config?.files.openByDefault]);

  const activeTabId = tabs.some((tab) => tab.id === activeId) ? activeId : (tabs.at(-1)?.id ?? null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activePane = activeTab ? (findLeaf(activeTab.layout, activeTab.activePaneId) ?? firstLeaf(activeTab.layout)) : null;
  const monitorConnection = activeTab?.connectionId
    ? (connections.find((item) => item.id === activeTab.connectionId) ?? null)
    : null;
  const monitorRemote = Boolean(activeTab?.connectionId && activePane?.capabilities.includes('exec'));
  const monitorTargetLabel = monitorRemote
    ? monitorConnection
      ? `${monitorConnection.username ?? ''}@${monitorConnection.host ?? ''}${monitorConnection.port ? `:${monitorConnection.port}` : ''}`.replace(/^@/, '')
      : '远端主机'
    : '这台 Mac';
  const activeConnectionId = activePane?.connectionId ?? null;
  const filesAvailable = activePane?.capabilities.includes('file') === true;
  const forwardAvailable = activePane?.capabilities.includes('forward') === true;
  const filesOpen = isPanelOpen(panelLayout, 'files');
  const monitorOpen = isPanelOpen(panelLayout, 'monitor');

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
      if (connectingRef.current) return;
      connectingRef.current = connection.id;
      setConnectingId(connection.id);
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
            const host = result.error.host ?? connection.host;
            const port = result.error.port ?? connection.port ?? 22;
            if (leaves.length === 0 && result.error.code === 'HOST_KEY_CHANGED' && fingerprint && host) {
              setHostKey({ connection, fingerprint, first: result.error.message.includes('首次'), host, port });
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
        applyFilesDefault();
      } finally {
        connectingRef.current = null;
        setConnectingId(null);
        setBusy(false);
      }
    },
    [addTab, applyFilesDefault, loadLayout],
  );

  const confirmHostKey = useCallback(async (): Promise<void> => {
    if (!hostKey) return;
    const { connection, fingerprint, host, port } = hostKey;
    setBusy(true);
    try {
      const saved = await window.eterm.rememberHostKey(host, port, fingerprint);
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
      applyFilesDefault();
    },
    [activeTab, applyFilesDefault, persistLayout],
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

      cancelReconnect(paneId);
      closeSessionPlanned(leaf.sessionId);
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
    [cancelReconnect, closeSessionPlanned, persistLayout, tabs],
  );

  const closeTab = useCallback(
    (id: string): void => {
      const tab = tabs.find((item) => item.id === id);
      if (tab) {
        for (const leaf of collectLeaves(tab.layout)) {
          cancelReconnect(leaf.paneId);
          closeSessionPlanned(leaf.sessionId);
        }
      }
      setTabs((current) => current.filter((item) => item.id !== id));
    },
    [cancelReconnect, closeSessionPlanned, tabs],
  );

  const cycleTab = useCallback(
    (delta: number): void => {
      if (tabs.length < 2) return;
      const index = tabs.findIndex((tab) => tab.id === activeTabId);
      if (index < 0) return;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (next) setActiveId(next.id);
    },
    [activeTabId, tabs],
  );

  const runCommand = useCallback(
    (id: CommandId): void => {
      switch (id) {
        case 'terminal.new':
          void openLocalTerminal();
          break;
        case 'connection.new':
          openNewForm();
          break;
        case 'tab.close':
          if (activeTabId) closeTab(activeTabId);
          break;
        case 'tab.next':
          cycleTab(1);
          break;
        case 'tab.prev':
          cycleTab(-1);
          break;
        case 'pane.close':
          if (activeTab && activePane) closePane(activeTab.id, activePane.paneId);
          break;
        case 'pane.split-row':
          void splitActivePane('row');
          break;
        case 'pane.split-column':
          void splitActivePane('column');
          break;
        case 'files.toggle':
          if (filesAvailable) togglePanel('files');
          break;
        case 'panel.monitor':
          togglePanel('monitor');
          break;
        case 'forward.open':
          if (forwardAvailable) setForwardOpen(true);
          break;
        case 'settings.open':
          openSettings();
          break;
        case 'palette.open':
          setPaletteOpen(true);
          break;
      }
    },
    [
      activePane,
      activeTab,
      activeTabId,
      closePane,
      closeTab,
      cycleTab,
      filesAvailable,
      forwardAvailable,
      openLocalTerminal,
      openNewForm,
      openSettings,
      splitActivePane,
      togglePanel,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = findCommandByShortcut(event);
      if (!command) return;
      event.preventDefault();
      runCommand(command.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runCommand]);

  const canSplit = activeTab ? countLeaves(activeTab.layout) < 4 : false;

  const panelChrome = (id: PanelId, dock: DockId) => {
    const panels = panelLayout.docks[dock];
    const index = panels.indexOf(id);
    return {
      canPanelMoveUp: index > 0,
      canPanelMoveDown: index >= 0 && index < panels.length - 1,
      onPanelReorder: (delta: -1 | 1) => movePanelOrder(id, delta),
    };
  };

  const renderPanel = (id: PanelId, dock: DockId): ReactNode => {
    switch (id) {
      case 'sessions':
        return (
          <SessionTree
            groups={groups}
            connections={connections}
            activeConnectionId={activeConnectionId}
            connectingId={connectingId}
            dock={dock}
            onMove={(target) => movePanelTo('sessions', target)}
            query={query}
            onQueryChange={setQuery}
            onConnect={(connection) => void openConnection(connection)}
            onNew={openNewForm}
            onEdit={(connection) => void openEditForm(connection)}
            onDelete={(connection) => void removeConnection(connection)}
            onAddGroup={(name) => void addGroup(name)}
            onReorder={(orderedIds) => void reorderConnections(orderedIds)}
            {...panelChrome('sessions', dock)}
          />
        );
      case 'files':
        return activePane ? (
          <FilePanel
            sessionId={activePane.sessionId}
            dock={dock}
            onMove={(target) => movePanelTo('files', target)}
            {...panelChrome('files', dock)}
          />
        ) : (
          <PanelFrame
            panelId="files"
            title="文件"
            dock={dock}
            onMove={(target) => movePanelTo('files', target)}
            canMoveUp={panelChrome('files', dock).canPanelMoveUp}
            canMoveDown={panelChrome('files', dock).canPanelMoveDown}
            onReorder={panelChrome('files', dock).onPanelReorder}
          >
            <p className="panel-empty">打开一个 SSH 连接后可以浏览远端文件</p>
          </PanelFrame>
        );
      case 'monitor':
        return (
          <MonitorPanel
            sessionId={monitorRemote ? (activePane?.sessionId ?? null) : null}
            targetLabel={monitorTargetLabel}
            connectionName={monitorConnection?.name ?? null}
            processSort={config?.ui.monitorProcessSort ?? 'memory'}
            onProcessSortChange={changeProcessSort}
            dock={dock}
            onMove={(target) => movePanelTo('monitor', target)}
            {...panelChrome('monitor', dock)}
          />
        );
      case 'transfers':
        return (
          <TransferPanel
            tasks={transfers}
            dock={dock}
            onMove={(target) => movePanelTo('transfers', target)}
            onCancel={(id) => void cancelTransfer(id)}
            onRetry={(id) => void retryTransfer(id)}
            onOpenFiles={() => {
              if (!panelDockOf(panelLayoutRef.current, 'files')) togglePanel('files');
            }}
            {...panelChrome('transfers', dock)}
          />
        );
      default:
        return null;
    }
  };

  const dockPanels = (dock: DockId): { definition: ReturnType<typeof panelsInDock>[number]; node: ReactNode }[] =>
    panelsInDock(panelLayout, dock).map((definition) => ({ definition, node: renderPanel(definition.id, dock) }));

  const leftPanels = dockPanels('left');
  const rightPanels = dockPanels('right');
  const bottomPanels = dockPanels('bottom');
  const fontSize = config?.terminal.fontSize ?? 13;
  const rightClick = config?.terminal.rightClick ?? 'paste';
  const rightClickCopySelection = config?.terminal.rightClickCopySelection ?? false;
  const density = config?.ui.density ?? 'comfortable';
  const themePreference = config?.ui.theme ?? 'system';
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference;

  useEffect(() => {
    // 变量挂在 html 上，切换主题不重建任何面板。
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <div className="app" data-density={density}>
      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        filesAvailable={filesAvailable}
        filesOpen={filesOpen}
        monitorOpen={monitorOpen}
        forwardAvailable={forwardAvailable}
        canSplit={canSplit}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openLocalTerminal()}
        onToggleFiles={() => togglePanel('files')}
        onToggleMonitor={() => togglePanel('monitor')}
        onOpenForward={() => setForwardOpen(true)}
        onSplit={(direction) => void splitActivePane(direction)}
        onOpenSettings={openSettings}
      />
      <div className="app__body">
        <DockColumn
          dock="left"
          panels={leftPanels}
          dividers={panelLayout.dividers.left}
          onResize={(index, ratio) => resizePanelDivider('left', index, ratio)}
          onResizeEnd={(index, ratio) => finishPanelDivider('left', index, ratio)}
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
          {reconnectNotice ? (
            <div className="reconnect-bar" data-testid="reconnect-bar">
              连接断开，正在重连（{reconnectNotice.attempt}/{RECONNECT_MAX}）…
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
                    theme={resolvedTheme}
                    rightClick={rightClick}
                    rightClickCopySelection={rightClickCopySelection}
                    onActivate={(paneId) => setPaneActive(tab.id, paneId)}
                    onClose={(paneId) => closePane(tab.id, paneId)}
                    onResize={(splitId, ratio) => resizePane(tab.id, splitId, ratio)}
                    onResizeEnd={(splitId, ratio) => finishResize(tab.id, splitId, ratio)}
                  />
                </section>
              ))
            )}
          </div>
          <DockColumn
            dock="bottom"
            panels={bottomPanels}
            dividers={panelLayout.dividers.bottom}
            onResize={(index, ratio) => resizePanelDivider('bottom', index, ratio)}
            onResizeEnd={(index, ratio) => finishPanelDivider('bottom', index, ratio)}
          />
        </main>
        <DockColumn
          dock="right"
          panels={rightPanels}
          dividers={panelLayout.dividers.right}
          onResize={(index, ratio) => resizePanelDivider('right', index, ratio)}
          onResizeEnd={(index, ratio) => finishPanelDivider('right', index, ratio)}
        />
      </div>

      {form ? (
        <ConnectionForm
          groups={groups}
          connections={connections}
          components={components}
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
          panelLayout={panelLayout}
          onChange={(next) => void saveConfig(next)}
          onPanelDockChange={(id, dock) => {
            if (panelDockOf(panelLayoutRef.current, id) === dock) return;
            movePanelTo(id, dock);
          }}
          onReset={() => void resetConfig()}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          onRun={(id) => {
            setPaletteOpen(false);
            runCommand(id);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {forwardOpen && activePane && forwardAvailable ? (
        <ForwardDialog sessionId={activePane.sessionId} onClose={() => setForwardOpen(false)} />
      ) : null}
    </div>
  );
}
