import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError, normalizeError } from '../../src/core/errors.ts';

test('errors_product_error_uses_human_message_by_default', () => {
  const error = new ProductError('AUTH_FAILED');

  assert.equal(error.message, '认证失败：用户名或密钥不匹配');
  assert.equal(error.next, '检查用户名与密钥后重试');
  assert.equal(error.code, 'AUTH_FAILED');
});

test('errors_product_error_keeps_code_when_message_overridden', () => {
  const error = new ProductError('UNSUPPORTED', { message: '当前版本不支持 telnet 连接' });

  assert.equal(error.code, 'UNSUPPORTED');
  assert.equal(error.message, '当前版本不支持 telnet 连接');
  assert.equal(error.next, '换一个支持该操作的连接');
});

test('errors_connection_refused_maps_to_host_unreachable', () => {
  const raw = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:22'), { code: 'ECONNREFUSED' });
  const error = normalizeError(raw);

  assert.equal(error.code, 'HOST_UNREACHABLE');
  assert.equal(error.detail, 'connect ECONNREFUSED 127.0.0.1:22');
});

test('errors_timeout_maps_to_timeout', () => {
  const error = normalizeError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));

  assert.equal(error.code, 'TIMEOUT');
});

test('errors_unknown_failure_maps_to_internal_and_keeps_detail', () => {
  const error = normalizeError(new Error('spawn /bin/nope ENOENT'));

  assert.equal(error.code, 'INTERNAL');
  assert.equal(error.detail, 'spawn /bin/nope ENOENT');
  assert.equal(error.message, '操作没有完成');
});

test('errors_product_error_passes_through_unchanged', () => {
  const original = new ProductError('FILE_NOT_FOUND');

  assert.equal(normalizeError(original), original);
});

test('errors_info_contains_folded_detail', () => {
  const info = new ProductError('PERMISSION_DENIED', { detail: 'EACCES: permission denied' }).toInfo();

  assert.deepEqual(info, {
    code: 'PERMISSION_DENIED',
    message: '权限不足：远端拒绝了这次操作',
    next: '换有权限的账号，或调整目标文件权限',
    detail: 'EACCES: permission denied',
  });
});
