import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type {
  AppConfig,
  ComponentDescriptor,
  ComponentSample,
  ConnectionInput,
  ConnectionRecord,
  GroupRecord,
  ProductErrorInfo,
  TransferView,
} from '../shared/ipc.ts';
import { extractFingerprint } from '../shared/fingerprints.ts';
import type { ThemeDefinition } from '../shared/theme.ts';
import { applyUiTheme, resolveTheme, terminalThemeFor } from './theme.ts';
import { countTemplateLeaves } from '../shared/layout-template.ts';
import { defaultPanelLayout, isPanelOpen, movePanel, movePanelWithinDock, panelDockOf, setDivider, setDockSize, type DockId, type PanelId, type PanelLayout } from '../shared/panels.ts';
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
import { type CommandId } from './commands/registry.ts';
import { findCommandByShortcut, resolveShortcuts } from './commands/resolve.ts';
import { normalizeLocale, setLocale, t } from '../shared/i18n/index.ts';
import { previewConfig } from './settings-draft.ts';
import { panelById, panelsInDock } from './panels/registry.ts';
import { ConnectionForm, type FormSecrets } from './components/ConnectionForm.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { FilePanel } from './components/FilePanel.tsx';
import { ForwardDialog } from './components/ForwardDialog.tsx';
import { HostKeyDialog, type HostKeyPrompt } from './components/HostKeyDialog.tsx';
import { LocalShellDialog } from './components/LocalShellDialog.tsx';
import { MonitorPanel } from './components/MonitorPanel.tsx';
import { PaneLayout } from './components/PaneLayout.tsx';
import { SessionTree } from './components/SessionTree.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import type { TerminalHandle } from './components/TerminalView.tsx';
import { DockColumn } from './components/DockColumn.tsx';
import { DockResizer, dockSizeMax } from './components/DockResizer.tsx';
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
  // 设置面板的草稿：面板内只改草稿，保存才写盘；取消回到已保存配置。
  const [settingsDraft, setSettingsDraft] = useState<AppConfig | null>(null);
  const settingsDraftRef = useRef<AppConfig | null>(null);
  // 顶部短暂提示：给「已保存」「已恢复默认布局」这类没有视觉变化的动作一个反馈。
  const [notice, setNotice] = useState<string | null>(null);
  // 终端句柄与当前活动 pane：应用菜单的复制 / 粘贴 / 全选需要拿到终端实例。
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const activePaneRef = useRef<string | null>(null);
  // 配置保存要串行：连续改设置时，后一次保存必须基于前一次的结果，不能互相覆盖。
  const configQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingConfigSaves = useRef(0);
  const configVersionRef = useRef(0);
  const [components, setComponents] = useState<ComponentDescriptor[]>([]);
  const [componentSamples, setComponentSamples] = useState<ComponentSample[]>([]);
  const [componentsBusy, setComponentsBusy] = useState(false);
  const [componentsNotice, setComponentsNotice] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [shellDialogOpen, setShellDialogOpen] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  // 草稿优先：设置面板打开期间，只有外观类字段跟草稿走（即时预览），其余仍用已保存值。
  const effectiveConfig = settingsDraft && config ? previewConfig(settingsDraft, config) : (settingsDraft ?? config);
  // 语言在渲染前同步给 i18n 模块：t() 是模块级函数，随后渲染的组件树即为新语言。
  const locale = normalizeLocale(effectiveConfig?.ui.language ?? 'system', navigator.language);
  setLocale(locale);
  // 快捷键生效表随草稿变化，设置面板里改完能立即预览冲突。
  const shortcuts = useMemo(
    () => resolveShortcuts(effectiveConfig?.shortcuts.overrides ?? {}),
    [effectiveConfig?.shortcuts.overrides],
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
      // 设置面板有未保存草稿时也忽略，避免外部保存覆盖正在编辑的内容。
      if (settingsDraftRef.current) return;
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
    void window.eterm.listThemes().then((result) => {
      if (result.ok) setThemes(result.value);
    });
  }, []);

  const loadComponentSamples = useCallback(async (): Promise<void> => {
    const result = await window.eterm.listComponentSamples();
    if (result.ok) setComponentSamples(result.value);
  }, []);

  useEffect(() => {
    void loadComponentSamples();
  }, [loadComponentSamples]);

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

  const pauseTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.pauseTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const resumeTransfer = useCallback(async (id: string): Promise<void> => {
    const result = await window.eterm.resumeTransfer(id);
    if (!result.ok) setError(result.error);
  }, []);

  const reloadThemes = useCallback(async (): Promise<void> => {
    const result = await window.eterm.listThemes();
    if (result.ok) setThemes(result.value);
    else setSettingsError(result.error.message);
  }, []);

  const openThemesDir = useCallback(async (): Promise<void> => {
    const result = await window.eterm.openThemesDir();
    if (!result.ok) setError(result.error);
  }, []);

  const installComponentSamples = useCallback(async (): Promise<void> => {
    setComponentsBusy(true);
    setComponentsNotice(null);
    try {
      const result = await window.eterm.installComponentSamples();
      if (!result.ok) {
        setSettingsError(result.error.message);
        return;
      }
      await loadComponentSamples();
      const count = result.value.installed.length;
      setComponentsNotice(
        count > 0 ? t('settings.extensions.installDone', { count }) : t('settings.extensions.installNone'),
      );
    } finally {
      setComponentsBusy(false);
    }
  }, [loadComponentSamples]);

  const installComponentSample = useCallback(
    async (id: string): Promise<void> => {
      setComponentsBusy(true);
      setComponentsNotice(null);
      try {
        const result = await window.eterm.installComponentSamples([id]);
        if (!result.ok) {
          setSettingsError(result.error.message);
          return;
        }
        await loadComponentSamples();
        const count = result.value.installed.length;
        setComponentsNotice(
          count > 0 ? t('settings.extensions.installDone', { count }) : t('settings.extensions.installNone'),
        );
      } finally {
        setComponentsBusy(false);
      }
    },
    [loadComponentSamples],
  );

  const uninstallComponentSample = useCallback(
    async (id: string): Promise<void> => {
      setComponentsBusy(true);
      setComponentsNotice(null);
      try {
        const result = await window.eterm.uninstallComponentSample(id);
        if (!result.ok) {
          setSettingsError(result.error.message);
          return;
        }
        await loadComponentSamples();
        const count = result.value.removed.length;
        setComponentsNotice(
          count > 0
            ? t('settings.extensions.uninstallDone', { count })
            : t('settings.extensions.uninstallNone'),
        );
      } finally {
        setComponentsBusy(false);
      }
    },
    [loadComponentSamples],
  );

  const openComponentsDir = useCallback(async (): Promise<void> => {
    const result = await window.eterm.openComponentsDir();
    if (!result.ok) setError(result.error);
  }, []);

  const saveConfig = useCallback((next: AppConfig, onSaved?: () => void): void => {
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
          onSaved?.();
        } else if (!result.ok) setSettingsError(result.error.message);
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : t('app.saveConfigFailed'));
      })
      .finally(() => {
        pendingConfigSaves.current -= 1;
      });
  }, []);

  // 首次启动引导只看一次：关闭或执行任一动作后写标记。
  const dismissOnboarded = useCallback((): void => {
    const current = configRef.current;
    if (!current || current.ui.onboarded) return;
    saveConfig({ ...current, ui: { ...current.ui, onboarded: true } });
  }, [saveConfig]);

  const changeProcessSort = useCallback(
    (sort: AppConfig['ui']['monitorProcessSort']): void => {
      const current = configRef.current;
      if (!current || current.ui.monitorProcessSort === sort) return;
      saveConfig({ ...current, ui: { ...current.ui, monitorProcessSort: sort } });
    },
    [saveConfig],
  );

  const previewSettings = useCallback((next: AppConfig): void => {
    settingsDraftRef.current = next;
    setSettingsDraft(next);
  }, []);

  const saveSettings = useCallback(
    (next: AppConfig): void => {
      // 草稿等保存成功再清：写盘失败时面板仍保留用户输入，可以重试。
      saveConfig(next, () => {
        settingsDraftRef.current = null;
        setSettingsDraft(null);
        setSettingsOpen(false);
        setNotice(t('settings.saved'));
      });
    },
    [saveConfig],
  );

  const cancelSettings = useCallback((): void => {
    settingsDraftRef.current = null;
    setSettingsDraft(null);
    setSettingsOpen(false);
  }, []);

  const openSettings = useCallback((): void => {
    setSettingsError(null);
    // 打开时以当前已保存配置作为草稿起点，后续改动都只写草稿。
    settingsDraftRef.current = configRef.current;
    setSettingsDraft(configRef.current);
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

  // 布局是即时模型，不走设置草稿；恢复后直接落盘。
  const resetPanelLayout = useCallback((): void => {
    applyPanelLayout(defaultPanelLayout(), true);
    setNotice(t('settings.resetLayoutDone'));
  }, [applyPanelLayout]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  const resizeDock = useCallback(
    (dock: DockId, size: number): void => {
      applyPanelLayout(setDockSize(panelLayoutRef.current, dock, size), false);
    },
    [applyPanelLayout],
  );

  const finishDockResize = useCallback(
    (dock: DockId, size: number): void => {
      applyPanelLayout(setDockSize(panelLayoutRef.current, dock, size), true);
    },
    [applyPanelLayout],
  );

  useEffect(() => {
    // 窗口变窄时把超出边界的宽度收回来，保证工作区仍有最小可用宽度。
    const handleResize = (): void => {
      const current = panelLayoutRef.current;
      const leftOpen = current.docks.left.length > 0;
      const rightOpen = current.docks.right.length > 0;
      const left = leftOpen
        ? Math.min(current.sizes.left, dockSizeMax('left', rightOpen ? current.sizes.right : 0))
        : current.sizes.left;
      const right = rightOpen
        ? Math.min(current.sizes.right, dockSizeMax('right', leftOpen ? left : 0))
        : current.sizes.right;
      if (left === current.sizes.left && right === current.sizes.right) return;
      applyPanelLayout(setDockSize(setDockSize(current, 'left', left), 'right', right), true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applyPanelLayout]);

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

  useEffect(() => {
    activePaneRef.current = activePane?.paneId ?? null;
  }, [activePane]);

  const registerTerminalHandle = useCallback((paneId: string, handle: TerminalHandle | null): void => {
    if (handle) terminalHandlesRef.current.set(paneId, handle);
    else terminalHandlesRef.current.delete(paneId);
  }, []);

  const monitorConnection = activeTab?.connectionId
    ? (connections.find((item) => item.id === activeTab.connectionId) ?? null)
    : null;
  const monitorRemote = Boolean(activeTab?.connectionId && activePane?.capabilities.includes('exec'));
  const monitorTargetLabel = monitorRemote
    ? monitorConnection
      ? `${monitorConnection.username ?? ''}@${monitorConnection.host ?? ''}${monitorConnection.port ? `:${monitorConnection.port}` : ''}`.replace(/^@/, '')
      : t('app.remoteHost')
    : t('app.thisMac');
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

  const openLocalTerminal = useCallback(async (commandOverride?: string): Promise<void> => {
    setError(null);
    try {
      const template = await loadLayout('local');
      const count = template ? countTemplateLeaves(template) : 1;
      const leaves: PaneLeaf[] = [];
      // 启动命令在会话建立时快照：已开的终端不受后续设置影响；临时选择只作用于本次。
      const localCommand = commandOverride ?? configRef.current?.terminal.localCommand ?? '';

      for (let index = 0; index < count; index += 1) {
        const result = await window.eterm.openSession({
          protocol: 'local',
          cols: 80,
          rows: 24,
          target: { command: localCommand },
        });
        if (!result.ok) {
          for (const leaf of leaves) void window.eterm.closeSession(leaf.sessionId);
          setError(result.error);
          return;
        }
        leaves.push({
          type: 'leaf',
          paneId: `pane-${++paneSequence}`,
          sessionId: result.value.sessionId,
          title: t('app.localTerminal', { index: ++localSequence }),
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
        message: t('app.terminalFailed.message'),
        next: t('app.terminalFailed.next'),
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
              setHostKey({ connection, fingerprint, first: result.error.reason === 'first', host, port });
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
      const confirmed = window.confirm(t('app.deleteConnectionConfirm', { name: connection.name }));
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

  const deleteGroup = useCallback(
    async (group: GroupRecord): Promise<void> => {
      const confirmed = window.confirm(t('tree.deleteGroupConfirm', { name: group.name }));
      if (!confirmed) return;

      const result = await window.eterm.deleteGroup(group.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const renameGroup = useCallback(
    async (group: GroupRecord, name: string): Promise<void> => {
      const result = await window.eterm.saveGroup({ id: group.id, name });
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

      const title = tab.connectionId ? tab.title : t('app.localTerminal', { index: ++localSequence });
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
        case 'terminal.find': {
          const paneId = activePaneRef.current;
          if (paneId) terminalHandlesRef.current.get(paneId)?.find();
          break;
        }
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
      // 弹层打开时全局命令不分发：避免在设置 / 命令面板 / 连接表单里误触 ⌘W 这类动作。
      if (settingsOpen || paletteOpen || forwardOpen || hostKey || form || shellDialogOpen) return;
      const command = findCommandByShortcut(event, shortcuts);
      if (!command) return;
      event.preventDefault();
      runCommand(command.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runCommand, shortcuts, settingsOpen, paletteOpen, forwardOpen, hostKey, form, shellDialogOpen]);

  useEffect(() => {
    return window.eterm.onMenuCommand((command) => {
      // 菜单命令与快捷键共用同一道弹层守卫。
      if (settingsOpen || paletteOpen || forwardOpen || hostKey || form || shellDialogOpen) return;
      if (command === 'edit.copy' || command === 'edit.paste' || command === 'edit.selectAll') {
        const paneId = activePaneRef.current;
        const handle = paneId ? terminalHandlesRef.current.get(paneId) : null;
        if (!handle) return;
        if (command === 'edit.copy') handle.copy();
        else if (command === 'edit.paste') handle.paste();
        else handle.selectAll();
        return;
      }
      runCommand(command);
    });
  }, [runCommand, settingsOpen, paletteOpen, forwardOpen, hostKey, form, shellDialogOpen]);

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
            onDeleteGroup={(group) => void deleteGroup(group)}
            onRenameGroup={(group, name) => void renameGroup(group, name)}
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
            title={t('panel.files')}
            dock={dock}
            onMove={(target) => movePanelTo('files', target)}
            canMoveUp={panelChrome('files', dock).canPanelMoveUp}
            canMoveDown={panelChrome('files', dock).canPanelMoveDown}
            onReorder={panelChrome('files', dock).onPanelReorder}
          >
            <div className="panel-empty panel-empty--stacked" data-testid="files-empty">
              <p className="panel-empty__title">{t('files.emptyTitle')}</p>
              <p className="panel-empty__hint">{t('files.noSftpHint')}</p>
            </div>
          </PanelFrame>
        );
      case 'monitor':
        return (
          <MonitorPanel
            sessionId={monitorRemote ? (activePane?.sessionId ?? null) : null}
            targetLabel={monitorTargetLabel}
            connectionName={monitorConnection?.name ?? null}
            processSort={effectiveConfig?.ui.monitorProcessSort ?? 'memory'}
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
            onPause={(id) => void pauseTransfer(id)}
            onResume={(id) => void resumeTransfer(id)}
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
  const fontSize = effectiveConfig?.terminal.fontSize ?? 13;
  const onboarded = effectiveConfig?.ui.onboarded ?? true;
  const fontFamily = effectiveConfig?.terminal.fontFamily ?? 'sf-mono';
  const lineHeight = effectiveConfig?.terminal.lineHeight ?? 1.2;
  const cursorStyle = effectiveConfig?.terminal.cursorStyle ?? 'block';
  const cursorBlink = effectiveConfig?.terminal.cursorBlink ?? true;
  const scrollback = effectiveConfig?.terminal.scrollback ?? 1000;
  const showLineNumbers = effectiveConfig?.terminal.showLineNumbers ?? true;
  const showTimestamps = effectiveConfig?.terminal.showTimestamps ?? true;
  const rightClick = effectiveConfig?.terminal.rightClick ?? 'paste';
  const rightClickCopySelection = effectiveConfig?.terminal.rightClickCopySelection ?? false;
  const density = effectiveConfig?.ui.density ?? 'comfortable';
  const themePreference = effectiveConfig?.ui.theme ?? 'system';
  const resolvedTheme = useMemo(
    () => resolveTheme(themePreference, systemTheme, themes),
    [themePreference, systemTheme, themes],
  );
  const terminalTheme = useMemo(
    () => terminalThemeFor(resolvedTheme.base, resolvedTheme.definition),
    [resolvedTheme],
  );

  useEffect(() => {
    // 变量挂在 html 上，切换主题不重建任何面板；外部主题的覆盖在这里统一清理。
    applyUiTheme(resolvedTheme.base, resolvedTheme.definition);
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
        onNewShell={(command) => void openLocalTerminal(command)}
        onNewCustomShell={() => setShellDialogOpen(true)}
        onToggleFiles={() => togglePanel('files')}
        onToggleMonitor={() => togglePanel('monitor')}
        onOpenForward={() => setForwardOpen(true)}
        onSplit={(direction) => void splitActivePane(direction)}
        onOpenSettings={openSettings}
      />
      <div className="app__body">
        <DockColumn
          dock="left"
          size={panelLayout.sizes.left}
          panels={leftPanels}
          dividers={panelLayout.dividers.left}
          onResize={(index, ratio) => resizePanelDivider('left', index, ratio)}
          onResizeEnd={(index, ratio) => finishPanelDivider('left', index, ratio)}
        />
        {leftPanels.length ? (
          <DockResizer
            side="left"
            size={panelLayout.sizes.left}
            otherSize={rightPanels.length ? panelLayout.sizes.right : 0}
            onResize={(size) => resizeDock('left', size)}
            onResizeEnd={(size) => finishDockResize('left', size)}
          />
        ) : null}
        <main className="workspace">
          {error && tabs.length > 0 ? (
            <div className="error-bar" data-testid="error-bar">
              <ErrorMessage error={error} />
              <button className="icon-button" type="button" title={t('error.close')} aria-label={t('error.close')} onClick={() => setError(null)}>
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          ) : null}
          {reconnectNotice ? (
            <div className="reconnect-bar" data-testid="reconnect-bar">
              {t('reconnect.notice', { attempt: reconnectNotice.attempt, max: RECONNECT_MAX })}
            </div>
          ) : null}
          <div className="workspace__content">
            {tabs.length === 0 ? (
              <EmptyState
                error={error}
                showGuide={!onboarded && connections.length === 0}
                onNewConnection={() => {
                  dismissOnboarded();
                  openNewForm();
                }}
                onNewTerminal={() => {
                  dismissOnboarded();
                  void openLocalTerminal();
                }}
                onOpenSettings={() => {
                  dismissOnboarded();
                  openSettings();
                }}
                onDismissGuide={dismissOnboarded}
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
                    fontFamily={fontFamily}
                    lineHeight={lineHeight}
                    cursorStyle={cursorStyle}
                    cursorBlink={cursorBlink}
                    scrollback={scrollback}
                    showLineNumbers={showLineNumbers}
                    showTimestamps={showTimestamps}
                    theme={terminalTheme}
                    rightClick={rightClick}
                    rightClickCopySelection={rightClickCopySelection}
                    onActivate={(paneId) => setPaneActive(tab.id, paneId)}
                    onClose={(paneId) => closePane(tab.id, paneId)}
                    onResize={(splitId, ratio) => resizePane(tab.id, splitId, ratio)}
                    onResizeEnd={(splitId, ratio) => finishResize(tab.id, splitId, ratio)}
                    onTerminalReady={registerTerminalHandle}
                  />
                </section>
              ))
            )}
          </div>
          {bottomPanels.length ? (
            <DockResizer
              side="bottom"
              size={panelLayout.sizes.bottom}
              otherSize={0}
              onResize={(size) => resizeDock('bottom', size)}
              onResizeEnd={(size) => finishDockResize('bottom', size)}
            />
          ) : null}
          <DockColumn
            dock="bottom"
            size={panelLayout.sizes.bottom}
            panels={bottomPanels}
            dividers={panelLayout.dividers.bottom}
            onResize={(index, ratio) => resizePanelDivider('bottom', index, ratio)}
            onResizeEnd={(index, ratio) => finishPanelDivider('bottom', index, ratio)}
          />
        </main>
        {rightPanels.length ? (
          <DockResizer
            side="right"
            size={panelLayout.sizes.right}
            otherSize={leftPanels.length ? panelLayout.sizes.left : 0}
            onResize={(size) => resizeDock('right', size)}
            onResizeEnd={(size) => finishDockResize('right', size)}
          />
        ) : null}
        <DockColumn
          dock="right"
          size={panelLayout.sizes.right}
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
          config={settingsDraft ?? config}
          savedConfig={config}
          error={settingsError}
          panelLayout={panelLayout}
          onChange={previewSettings}
          onSave={() => saveSettings(settingsDraft ?? config)}
          onCancel={cancelSettings}
          onResetLayout={resetPanelLayout}
          onPanelDockChange={(id, dock) => {
            if (panelDockOf(panelLayoutRef.current, id) === dock) return;
            movePanelTo(id, dock);
          }}
          onDockSizeChange={finishDockResize}
          themes={themes}
          onReloadThemes={() => void reloadThemes()}
          onOpenThemesDir={() => void openThemesDir()}
          components={components}
          componentSamples={componentSamples}
          componentsBusy={componentsBusy}
          componentsNotice={componentsNotice}
          onInstallComponentSamples={() => void installComponentSamples()}
          onInstallComponentSample={(id) => void installComponentSample(id)}
          onUninstallComponentSample={(id) => void uninstallComponentSample(id)}
          onOpenComponentsDir={() => void openComponentsDir()}
        />
      ) : null}

      {shellDialogOpen ? (
        <LocalShellDialog
          onCancel={() => setShellDialogOpen(false)}
          onSubmit={(command) => {
            setShellDialogOpen(false);
            void openLocalTerminal(command);
          }}
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

      {notice ? (
        <div className="toast" role="status" data-testid="toast">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
