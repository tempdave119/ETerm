export type SplitDirection = 'row' | 'column';

export interface LayoutLeafTemplate {
  type: 'leaf';
}

export interface LayoutSplitTemplate {
  type: 'split';
  direction: SplitDirection;
  ratio: number;
  first: LayoutTemplate;
  second: LayoutTemplate;
}

export type LayoutTemplate = LayoutLeafTemplate | LayoutSplitTemplate;

export function countTemplateLeaves(node: LayoutTemplate): number {
  return node.type === 'leaf' ? 1 : countTemplateLeaves(node.first) + countTemplateLeaves(node.second);
}

/** 解析来自磁盘或渲染层的模板；叶子 1–4、比例 0.2–0.8，防止坏结构把界面撑坏。 */
export function parseLayoutTemplate(value: unknown): LayoutTemplate {
  const leaves = countParsed(parseNode(value));
  if (leaves > 4) throw new Error('分屏模板最多 4 个 pane');
  return parseNode(value);
}

function parseNode(value: unknown): LayoutTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('布局模板必须是对象');
  }
  const record = value as Record<string, unknown>;

  if (record.type === 'leaf') return { type: 'leaf' };
  if (record.type !== 'split') throw new Error('布局节点类型无效');

  const direction = record.direction;
  if (direction !== 'row' && direction !== 'column') throw new Error('分屏方向无效');
  const ratio = record.ratio;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.2 || ratio > 0.8) {
    throw new Error('分屏比例必须在 0.2–0.8 之间');
  }

  return {
    type: 'split',
    direction,
    ratio,
    first: parseNode(record.first),
    second: parseNode(record.second),
  };
}

function countParsed(node: LayoutTemplate): number {
  return node.type === 'leaf' ? 1 : countParsed(node.first) + countParsed(node.second);
}
