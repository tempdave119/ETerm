/**
 * 面板开关状态：只持久化可停靠面板的开关，弹层（设置 / 命令面板）不落盘，
 * 否则重启后会自动弹出模态框。与 split 布局分开存，互不覆盖。
 */

export interface PanelState {
  files: boolean;
  monitor: boolean;
}

export function defaultPanelState(): PanelState {
  return { files: true, monitor: false };
}

/** 磁盘或 IPC 传入的状态：坏字段回退默认值，不因为一个新字段丢掉整份布局。 */
export function parsePanelState(value: unknown): PanelState {
  const defaults = defaultPanelState();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults;

  const record = value as Record<string, unknown>;
  return {
    files: typeof record.files === 'boolean' ? record.files : defaults.files,
    monitor: typeof record.monitor === 'boolean' ? record.monitor : defaults.monitor,
  };
}
