import { useEffect, useRef } from 'react';
import type { DockId } from '../../shared/panels.ts';
import { parsePluginPanelId } from '../../shared/plugins.ts';
import { PanelFrame } from './PanelFrame.tsx';

interface PluginPanelProps {
  pluginId: string;
  /** 布局里的插件面板 id：plugin:<pluginId>:<panelId>。 */
  panelId: string;
  title: string;
  dock: DockId | null;
  onMove(target: DockId | null): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

/**
 * 插件面板容器：iframe 加载插件目录下的 panel.html。
 * sandbox 只给 allow-scripts，不给 same-origin —— 插件脚本拿不到宿主渲染上下文。
 * 面板数据通过 postMessage → 宿主 → 主进程插件 handler 的桥获取。
 */
export function PluginPanel({
  pluginId,
  panelId,
  title,
  dock,
  onMove,
  canPanelMoveUp,
  canPanelMoveDown,
  onPanelReorder,
}: PluginPanelProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // 布局 id 带 plugin: 前缀，插件 handler 用 manifest 里的本地 panelId。
  const localPanelId = parsePluginPanelId(panelId)?.panelId ?? panelId;

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = frameRef.current;
      const source = frame?.contentWindow;
      if (!frame || !source || event.source !== source) return;

      const data = event.data as { type?: unknown; requestId?: unknown; payload?: unknown } | null;
      if (!data || data.type !== 'eterm-plugin:request' || typeof data.requestId !== 'string') return;

      void window.eterm.sendPluginPanelMessage(pluginId, localPanelId, data.payload ?? null).then((result) => {
        source.postMessage(
          result.ok
            ? {
                type: 'eterm-plugin:response',
                requestId: data.requestId,
                ok: true,
                value: result.value ?? null,
              }
            : {
                type: 'eterm-plugin:response',
                requestId: data.requestId,
                ok: false,
                error: result.error,
              },
          '*',
        );
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pluginId, localPanelId]);

  return (
    <PanelFrame
      panelId={panelId}
      title={title}
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
    >
      <iframe
        ref={frameRef}
        className="plugin-panel"
        src={`eterm-plugin://${pluginId}/panel.html`}
        sandbox="allow-scripts allow-downloads"
        title={title}
        data-testid={`plugin-panel-${pluginId}`}
      />
    </PanelFrame>
  );
}