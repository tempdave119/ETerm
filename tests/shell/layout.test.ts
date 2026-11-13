import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRatio,
  collectLeaves,
  countLeaves,
  findLeaf,
  firstLeaf,
  removeAt,
  setRatioAt,
  splitAt,
  type LayoutNode,
  type PaneLeaf,
} from '../../src/shell/layout.ts';

function leaf(paneId: string): PaneLeaf {
  return { type: 'leaf', paneId, sessionId: `session-${paneId}`, title: paneId, capabilities: ['session'] };
}

test('layout_counts_and_collects_leaves', () => {
  const tree: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: { type: 'split', id: 's2', direction: 'column', ratio: 0.5, first: leaf('b'), second: leaf('c') },
  };

  assert.equal(countLeaves(tree), 3);
  assert.deepEqual(collectLeaves(tree).map((item) => item.paneId), ['a', 'b', 'c']);
  assert.equal(firstLeaf(tree).paneId, 'a');
  assert.equal(findLeaf(tree, 'c')?.paneId, 'c');
  assert.equal(findLeaf(tree, 'missing'), null);
});

test('layout_split_leaf_creates_split_node', () => {
  const tree = splitAt(leaf('a'), 'a', leaf('b'), 'row', 's1') as Extract<LayoutNode, { type: 'split' }>;

  assert.equal(tree.type, 'split');
  assert.equal(tree.direction, 'row');
  assert.equal(countLeaves(tree), 2);
  assert.equal(tree.first.type, 'leaf');
  assert.equal((tree.second as PaneLeaf).paneId, 'b');
});

test('layout_split_nested_leaf', () => {
  const start: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: leaf('b'),
  };

  const tree = splitAt(start, 'b', leaf('c'), 'column', 's2') as Extract<LayoutNode, { type: 'split' }>;

  assert.equal(countLeaves(tree), 3);
  const second = tree.second as Extract<LayoutNode, { type: 'split' }>;
  assert.equal(second.direction, 'column');
  assert.equal((second.first as PaneLeaf).paneId, 'b');
});

test('layout_remove_leaf_collapses_parent', () => {
  const start: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: leaf('b'),
  };

  const tree = removeAt(start, 'b');

  assert.equal(tree?.type, 'leaf');
  assert.equal((tree as PaneLeaf).paneId, 'a');
});

test('layout_remove_nested_leaf_keeps_shape', () => {
  const start: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: { type: 'split', id: 's2', direction: 'column', ratio: 0.5, first: leaf('b'), second: leaf('c') },
  };

  const tree = removeAt(start, 'b');

  assert.equal(countLeaves(tree as LayoutNode), 2);
  const second = (tree as Extract<LayoutNode, { type: 'split' }>).second;
  assert.equal((second as PaneLeaf).paneId, 'c');
});

test('layout_remove_last_leaf_returns_null', () => {
  assert.equal(removeAt(leaf('a'), 'a'), null);
});

test('layout_set_ratio_updates_nested_split_only', () => {
  const tree: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: { type: 'split', id: 's2', direction: 'column', ratio: 0.5, first: leaf('b'), second: leaf('c') },
  };

  const next = setRatioAt(tree, 's2', 0.7) as Extract<LayoutNode, { type: 'split' }>;

  assert.equal(next.ratio, 0.5);
  assert.equal((next.second as Extract<LayoutNode, { type: 'split' }>).ratio, 0.7);
  assert.equal((tree.second as Extract<LayoutNode, { type: 'split' }>).ratio, 0.5);
});

test('layout_set_ratio_clamps_to_template_range', () => {
  const tree: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: leaf('b'),
  };

  assert.equal((setRatioAt(tree, 's1', 0.1) as Extract<LayoutNode, { type: 'split' }>).ratio, 0.2);
  assert.equal((setRatioAt(tree, 's1', 0.95) as Extract<LayoutNode, { type: 'split' }>).ratio, 0.8);
  assert.equal(clampRatio(Number.NaN), 0.5);
});

test('layout_set_ratio_returns_same_tree_when_split_missing', () => {
  const tree: LayoutNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a'),
    second: leaf('b'),
  };

  assert.equal(setRatioAt(tree, 'missing', 0.7), tree);
});
