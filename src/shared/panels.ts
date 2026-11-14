/**
 * 面板布局：面板属于哪个停靠区、区内顺序、区内分隔比例。
 * 弹层面板（设置 / 命令面板）不参与停靠，不进这份状态。
 */

export type PanelId = 'sessions' | 'files' | 'monitor' | 'transfers' | 'settings' | 'commands';

/** 可停靠的三个区；弹层不在其列。 */
export type DockId = 'left' | 'right' | 'bottom';

export const DOCK_IDS: readonly DockId[] = ['left', 'right', 'bottom'];

/** 能进停靠区的面板；设置与命令面板是弹层，不参与。 */
export const DOCKABLE_PANEL_IDS: readonly PanelId[] = ['sessions', 'files', 'monitor', 'transfers'];

export interface PanelLayout {
  /** 每个停靠区内的面板顺序；空数组表示该区不渲染。 */
  docks: Record<DockId, PanelId[]>;
  /** 区内分隔位置（累计比例，0.15–0.85），长度 = 面板数 - 1。 */
  dividers: Record<DockId, number[]>;
  /** 左右栏宽度与底栏高度（px）。 */
  sizes: { left: number; right: number; bottom: number };
}

const MIN_GAP = 0.1;
const MIN_DIVIDER = 0.15;
const MAX_DIVIDER = 0.85;

/** 停靠区拖动边界；右栏下限保留监控面板两列指标卡所需的宽度。 */
export const DOCK_SIZE_LIMITS = {
  left: { min: 220, max: 360 },
  right: { min: 260, max: 450 },
  bottom: { min: 120, max: 360 },
} as const;

const DEFAULT_DOCK_SIZES = { left: 220, right: 300, bottom: 160 } as const;

export function defaultPanelLayout(): PanelLayout {
  return {
    docks: { left: ['sessions'], right: ['files'], bottom: ['transfers'] },
    dividers: { left: [], right: [], bottom: [] },
    sizes: { ...DEFAULT_DOCK_SIZES },
  };
}

/**
 * 解析磁盘或 IPC 传入的布局。
 * 兼容 v1 的旧格式 `{ files: boolean, monitor: boolean }`：按旧开关映射到右栏，
 * 其余沿用默认布局，避免升级后整份面板状态被丢弃。
 */
export function parsePanelLayout(value: unknown): PanelLayout {
  const defaults = defaultPanelLayout();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults;
  const record = value as Record<string, unknown>;

  if (!('docks' in record)) return migrateLegacyState(record, defaults);
  return parseDocks(record, defaults);
}

function migrateLegacyState(record: Record<string, unknown>, defaults: PanelLayout): PanelLayout {
  const { files, monitor } = record;
  if (typeof files !== 'boolean' && typeof monitor !== 'boolean') return defaults;

  const layout = defaultPanelLayout();
  const right: PanelId[] = [];
  // 旧默认 files 为 true；显式 false 才移除。
  if (files !== false) right.push('files');
  if (monitor === true) right.push('monitor');
  layout.docks.right = right;
  layout.dividers.right = uniformDividers(right.length);
  return layout;
}

function parseDocks(record: Record<string, unknown>, defaults: PanelLayout): PanelLayout {
  const rawDocks = record.docks;
  if (typeof rawDocks !== 'object' || rawDocks === null || Array.isArray(rawDocks)) return defaults;
  const docksRecord = rawDocks as Record<string, unknown>;

  const seen = new Set<PanelId>();
  const docks: Record<DockId, PanelId[]> = { left: [], right: [], bottom: [] };
  for (const dock of DOCK_IDS) {
    const list = docksRecord[dock];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const id = item as PanelId;
      // 未知 id、非停靠面板、重复出现（同一面板只能在一个区）一律跳过。
      if (!DOCKABLE_PANEL_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      docks[dock].push(id);
    }
  }

  const rawDividers = record.dividers;
  const dividersRecord =
    typeof rawDividers === 'object' && rawDividers !== null && !Array.isArray(rawDividers)
      ? (rawDividers as Record<string, unknown>)
      : {};

  const dividers: Record<DockId, number[]> = { left: [], right: [], bottom: [] };
  for (const dock of DOCK_IDS) {
    const expected = Math.max(0, docks[dock].length - 1);
    const raw = dividersRecord[dock];
    const values: number[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw.slice(0, expected)) {
        if (typeof item === 'number' && Number.isFinite(item)) values.push(item);
      }
    }
    // 缺失或非法值用均匀分布补齐，保证分隔条始终落在面板边界之间。
    while (values.length < expected) values.push((values.length + 1) / (expected + 1));
    dividers[dock] = normalizeDividers(values);
  }

  const rawSizes = record.sizes;
  const sizesRecord =
    typeof rawSizes === 'object' && rawSizes !== null && !Array.isArray(rawSizes)
      ? (rawSizes as Record<string, unknown>)
      : {};
  return {
    docks,
    dividers,
    sizes: {
      left: parseDockSize(sizesRecord.left, 'left'),
      right: parseDockSize(sizesRecord.right, 'right'),
      bottom: parseDockSize(sizesRecord.bottom, 'bottom'),
    },
  };
}

function parseDockSize(value: unknown, dock: DockId): number {
  const limit = DOCK_SIZE_LIMITS[dock];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DOCK_SIZES[dock];
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

/** 累计比例必须严格递增且相邻面板至少留出 MIN_GAP。 */
function normalizeDividers(values: number[]): number[] {
  const result: number[] = [];
  let previous = 0;
  for (let index = 0; index < values.length; index += 1) {
    const remaining = values.length - index;
    const upper = 1 - remaining * MIN_GAP;
    const next = Math.min(upper, Math.max(previous + MIN_GAP, clampDivider(values[index] ?? 0.5)));
    result.push(next);
    previous = next;
  }
  return result;
}

function clampDivider(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(MAX_DIVIDER, Math.max(MIN_DIVIDER, value));
}

function uniformDividers(count: number): number[] {
  if (count < 2) return [];
  return Array.from({ length: count - 1 }, (_, index) => (index + 1) / count);
}

export function panelDockOf(layout: PanelLayout, panelId: PanelId): DockId | null {
  for (const dock of DOCK_IDS) {
    if (layout.docks[dock].includes(panelId)) return dock;
  }
  return null;
}

export function isPanelOpen(layout: PanelLayout, panelId: PanelId): boolean {
  return panelDockOf(layout, panelId) !== null;
}

/** 把面板移到目标区末尾；target 为 null 表示关闭。 */
export function movePanel(layout: PanelLayout, panelId: PanelId, target: DockId | null): PanelLayout {
  const removed = removePanel(layout, panelId);
  if (!target) return removed;

  const list = [...removed.docks[target], panelId];
  const previousDividers = removed.dividers[target];
  // 追加面板后多出一个分隔：保留原有位置，新分隔放在末尾面板之间。
  const dividers = [...previousDividers, (1 + (previousDividers.at(-1) ?? 0)) / 2];
  return {
    docks: { ...removed.docks, [target]: list },
    dividers: { ...removed.dividers, [target]: normalizeDividers(dividers) },
    sizes: removed.sizes,
  };
}

/**
 * 在同一个停靠区内上移 / 下移一个面板。
 * 每个面板的比例跟着面板走，而不是跟着位置走；否则调换顺序后大小会错位。
 */
export function movePanelWithinDock(
  layout: PanelLayout,
  dock: DockId,
  panelId: PanelId,
  delta: -1 | 1,
): PanelLayout {
  const panels = layout.docks[dock];
  const index = panels.indexOf(panelId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= panels.length) return layout;

  const ratios = panelRatios(layout.dividers[dock], panels.length);
  const entries = panels.map((id, position) => ({ id, ratio: ratios[position] ?? 1 / panels.length }));
  const [moved] = entries.splice(index, 1);
  if (!moved) return layout;
  entries.splice(target, 0, moved);

  return {
    docks: { ...layout.docks, [dock]: entries.map((entry) => entry.id) },
    dividers: { ...layout.dividers, [dock]: cumulativeDividers(entries.map((entry) => entry.ratio)) },
    sizes: layout.sizes,
  };
}

/** 把累计分隔换算成每个面板的占比；缺分隔时用均匀分布补齐。 */
function panelRatios(dividers: number[], count: number): number[] {
  if (count <= 1) return [1];
  const expected = count - 1;
  const values = dividers.slice(0, expected);
  while (values.length < expected) values.push((values.length + 1) / count);
  const boundaries = [...normalizeDividers(values), 1];
  const ratios: number[] = [];
  let previous = 0;
  for (const boundary of boundaries) {
    ratios.push(Math.max(0, boundary - previous));
    previous = boundary;
  }
  return ratios;
}

function cumulativeDividers(ratios: number[]): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < ratios.length - 1; index += 1) {
    sum += ratios[index] ?? 0;
    result.push(sum);
  }
  return normalizeDividers(result);
}

export function removePanel(layout: PanelLayout, panelId: PanelId): PanelLayout {
  const dock = panelDockOf(layout, panelId);
  if (!dock) return layout;

  const index = layout.docks[dock].indexOf(panelId);
  const list = layout.docks[dock].filter((id) => id !== panelId);
  const dividers = dividersForRemoval(layout.dividers[dock], index, list.length);
  return {
    docks: { ...layout.docks, [dock]: list },
    dividers: { ...layout.dividers, [dock]: dividers },
    sizes: layout.sizes,
  };
}

/** 删除面板后同步删掉一个分隔，保留其余面板的相对大小。 */
function dividersForRemoval(dividers: number[], index: number, nextCount: number): number[] {
  if (nextCount <= 1) return [];
  const result = [...dividers].slice(0, nextCount - 1);
  if (index < result.length) result.splice(index, 1);
  return result;
}

/** 设置第 index 条分隔的累计比例；夹在相邻分隔之间，至少留 MIN_GAP。 */
export function setDivider(layout: PanelLayout, dock: DockId, index: number, ratio: number): PanelLayout {
  const panels = layout.docks[dock];
  if (panels.length < 2 || index < 0 || index >= panels.length - 1) return layout;

  const dividers = [...layout.dividers[dock]];
  while (dividers.length < panels.length - 1) {
    dividers.push((dividers.length + 1) / panels.length);
  }
  const previous = index === 0 ? 0 : (dividers[index - 1] ?? 0);
  const next = index === dividers.length - 1 ? 1 : (dividers[index + 1] ?? 1);
  dividers[index] = Math.min(next - MIN_GAP, Math.max(previous + MIN_GAP, ratio));
  return { ...layout, dividers: { ...layout.dividers, [dock]: dividers } };
}

/** 设置停靠区尺寸；静态边界之外的值夹回范围内。 */
export function setDockSize(layout: PanelLayout, dock: DockId, size: number): PanelLayout {
  const limit = DOCK_SIZE_LIMITS[dock];
  const next = Math.min(limit.max, Math.max(limit.min, Math.round(size)));
  if (next === layout.sizes[dock]) return layout;
  return { ...layout, sizes: { ...layout.sizes, [dock]: next } };
}
