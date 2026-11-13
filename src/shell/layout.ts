import type { Capability } from '../shared/ipc.ts';
import type { LayoutTemplate, SplitDirection } from '../shared/layout-template.ts';

export type { SplitDirection };

export interface PaneLeaf {
  type: 'leaf';
  paneId: string;
  sessionId: string;
  title: string;
  capabilities: Capability[];
  connectionId?: string;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  /** 第一个子节点占的比例，0–1。 */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = PaneLeaf | SplitNode;

export function countLeaves(node: LayoutNode): number {
  return node.type === 'leaf' ? 1 : countLeaves(node.first) + countLeaves(node.second);
}

export function collectLeaves(node: LayoutNode): PaneLeaf[] {
  if (node.type === 'leaf') return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

export function findLeaf(node: LayoutNode, paneId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId);
}

/** 自动重连后把 pane 的旧 sessionId / 能力换成新会话，其余布局信息不动。 */
export function replaceLeafSession(
  node: LayoutNode,
  paneId: string,
  sessionId: string,
  capabilities: Capability[],
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return node;
    return { ...node, sessionId, capabilities };
  }

  const first = replaceLeafSession(node.first, paneId, sessionId, capabilities);
  if (first !== node.first) return { ...node, first };
  const second = replaceLeafSession(node.second, paneId, sessionId, capabilities);
  if (second !== node.second) return { ...node, second };
  return node;
}

export function firstLeaf(node: LayoutNode): PaneLeaf {
  return node.type === 'leaf' ? node : firstLeaf(node.first);
}

/** 把目标叶子替换成「原叶子 + 新叶子」的分裂节点；找不到目标时原样返回。 */
export function splitAt(
  node: LayoutNode,
  paneId: string,
  next: PaneLeaf,
  direction: SplitDirection,
  splitId: string,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return node;
    return { type: 'split', id: splitId, direction, ratio: 0.5, first: node, second: next };
  }

  const first = splitAt(node.first, paneId, next, direction, splitId);
  if (first !== node.first) return { ...node, first };
  const second = splitAt(node.second, paneId, next, direction, splitId);
  if (second !== node.second) return { ...node, second };
  return node;
}

/** 移除目标叶子；只剩一个子节点时折叠父分裂节点，最后一个叶子移除后返回 null。 */
export function removeAt(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? null : node;

  const first = removeAt(node.first, paneId);
  if (first !== node.first) return first === null ? node.second : { ...node, first };

  const second = removeAt(node.second, paneId);
  if (second !== node.second) return second === null ? node.first : { ...node, second };

  return node;
}

/** 比例夹在 0.2–0.8：和布局模板的校验范围保持一致，拖到边上也不会把 pane 压没。 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.8, Math.max(0.2, value));
}

/** 按 splitId 写回比例；找不到目标时原样返回。 */
export function setRatioAt(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio: clampRatio(ratio) };

  const first = setRatioAt(node.first, splitId, ratio);
  if (first !== node.first) return { ...node, first };
  const second = setRatioAt(node.second, splitId, ratio);
  if (second !== node.second) return { ...node, second };
  return node;
}

/** 只保留结构，不存 sessionId；持久化用。 */
export function toTemplate(node: LayoutNode): LayoutTemplate {
  if (node.type === 'leaf') return { type: 'leaf' };
  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    first: toTemplate(node.first),
    second: toTemplate(node.second),
  };
}

/** 用真实会话叶子按顺序填充模板，重建布局树。 */
export function instantiateLayout(
  template: LayoutTemplate,
  leaves: PaneLeaf[],
  nextSplitId: () => string,
): LayoutNode {
  let index = 0;
  const build = (node: LayoutTemplate): LayoutNode => {
    if (node.type === 'leaf') {
      const leaf = leaves[index++];
      if (!leaf) throw new Error('布局模板的叶子多于可用会话');
      return leaf;
    }
    return {
      type: 'split',
      id: nextSplitId(),
      direction: node.direction,
      ratio: node.ratio,
      first: build(node.first),
      second: build(node.second),
    };
  };
  return build(template);
}
