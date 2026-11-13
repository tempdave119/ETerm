/**
 * 面板注册表：六个面板的标识、标题、停靠区与默认开关。
 * 只放元数据（不 import React），停靠区的渲染由外壳按 id 映射；
 * 设置与命令面板是弹层，不参与停靠区布局。
 */

export type PanelId = 'sessions' | 'files' | 'monitor' | 'transfers' | 'settings' | 'commands';
export type PanelDock = 'left' | 'right' | 'bottom' | 'overlay';

export interface PanelDefinition {
  id: PanelId;
  title: string;
  dock: PanelDock;
  defaultOpen: boolean;
}

export const PANELS: readonly PanelDefinition[] = [
  { id: 'sessions', title: '会话', dock: 'left', defaultOpen: true },
  { id: 'files', title: '文件', dock: 'right', defaultOpen: true },
  { id: 'monitor', title: '系统资源', dock: 'right', defaultOpen: false },
  { id: 'transfers', title: '传输队列', dock: 'bottom', defaultOpen: true },
  { id: 'settings', title: '设置', dock: 'overlay', defaultOpen: false },
  { id: 'commands', title: '命令面板', dock: 'overlay', defaultOpen: false },
];

const PANEL_BY_ID = new Map(PANELS.map((panel) => [panel.id, panel]));

export function panelById(id: PanelId): PanelDefinition | null {
  return PANEL_BY_ID.get(id) ?? null;
}

/** 某个停靠区当前应渲染的面板；未声明开关的面板用默认值。 */
export function panelsInDock(
  dock: PanelDock,
  open: Partial<Record<PanelId, boolean>>,
): PanelDefinition[] {
  return PANELS.filter((panel) => panel.dock === dock && (open[panel.id] ?? panel.defaultOpen));
}
