import test from 'node:test';
import assert from 'node:assert/strict';
import { DropTokenStore } from '../../src/services/transfers/drop-tokens.ts';

test('drop_tokens_register_and_take_once', () => {
  let nextId = 0;
  const store = new DropTokenStore({ createId: () => `t${++nextId}` });

  const tokens = store.register(['/tmp/a.txt', '/tmp/b.txt']);
  assert.deepEqual(tokens, ['t1', 't2']);
  assert.equal(store.take('t1'), '/tmp/a.txt');
  assert.equal(store.take('t1'), null);
  assert.equal(store.take('t2'), '/tmp/b.txt');
  assert.equal(store.size(), 0);
});

test('drop_tokens_expire_after_ttl', () => {
  let now = 1_000;
  let nextId = 0;
  const store = new DropTokenStore({
    ttlMs: 500,
    now: () => now,
    createId: () => `t${++nextId}`,
  });

  const [token] = store.register(['/tmp/a.txt']);
  now = 1_500;
  assert.equal(store.take(token ?? ''), null);
  assert.equal(store.size(), 0);
});

test('drop_tokens_prune_removes_expired_without_take', () => {
  let now = 0;
  let nextId = 0;
  const store = new DropTokenStore({
    ttlMs: 10,
    now: () => now,
    createId: () => `t${++nextId}`,
  });

  store.register(['/tmp/a.txt']);
  now = 20;
  store.prune();
  assert.equal(store.size(), 0);
});
