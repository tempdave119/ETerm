import type { DockId } from '../../shared/panels.ts';
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
        className="plugin-panel"
        src={`eterm-plugin://${pluginId}/panel.html`}
        sandbox="allow-scripts"
        title={title}
        data-testid={`plugin-panel-${pluginId}`}
      />
    </PanelFrame>
  );
}