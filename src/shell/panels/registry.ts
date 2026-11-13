/**
 * 面板注册表：面板的标识、标题与首次启用时的默认停靠区。
 * 只放元数据（不 import React）；实际停靠位置由 layout.json 的 PanelLayout 决定，
 * 停靠区的渲染由外壳按 id 映射；设置与命令面板是弹层，不参与停靠。
 */

import type { DockId, PanelId, PanelLayout } from '../../shared/panels.ts';

export type PanelDock = DockId | 'overlay';

export interface PanelDefinition {
  id: PanelId;
  title: string;
  /** 首次打开时落到哪个区；用户改过的位置以 PanelLayout 为准。 */
  defaultDock: PanelDock;
  defaultOpen: boolean;
}

export const PANELS: readonly PanelDefinition[] = [
  { id: 'sessions', title: '会话', defaultDock: 'left', defaultOpen: true },
  { id: 'files', title: '文件', defaultDock: 'right', defaultOpen: true },
  { id: 'monitor', title: '系统资源', defaultDock: 'right', defaultOpen: false },
  { id: 'transfers', title: '传输队列', defaultDock: 'bottom', defaultOpen: true },
  { id: 'settings', title: '设置', defaultDock: 'overlay', defaultOpen: false },
  { id: 'commands', title: '命令面板', defaultDock: 'overlay', defaultOpen: false },
];

const PANEL_BY_ID = new Map(PANELS.map((panel) => [panel.id, panel]));

export function panelById(id: PanelId): PanelDefinition | null {
  return PANEL_BY_ID.get(id) ?? null;
}

/** 某个停靠区当前应渲染的面板，顺序以用户布局为准。 */
export function panelsInDock(layout: PanelLayout, dock: DockId): PanelDefinition[] {
  return layout.docks[dock]
    .map((id) => panelById(id))
    .filter((panel): panel is PanelDefinition => panel !== null);
}
