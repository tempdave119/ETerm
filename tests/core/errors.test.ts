import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError, normalizeError } from '../../src/core/errors.ts';

test('errors_product_error_uses_human_message_by_default', () => {
  const error = new ProductError('AUTH_FAILED');

  assert.equal(error.message, '认证失败：用户名、密码或私钥不匹配');
  assert.equal(error.next, '核对用户名与密码 / 私钥后重试');
  assert.equal(error.code, 'AUTH_FAILED');
});

test('errors_product_error_allows_scenario_specific_next', () => {
  const error = new ProductError('UNSUPPORTED', {
    message: '这台主机没有开启 SFTP，文件面板不可用',
    next: '终端仍可正常使用；需要文件操作请换一台主机',
  });

  assert.equal(error.code, 'UNSUPPORTED');
  assert.equal(error.next, '终端仍可正常使用；需要文件操作请换一台主机');
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

test('errors_connection_reset_and_dns_failure_map_to_host_unreachable', () => {
  assert.equal(normalizeError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })).code, 'HOST_UNREACHABLE');
  assert.equal(normalizeError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })).code, 'HOST_UNREACHABLE');
});

test('errors_sftp_status_codes_map_to_product_codes', () => {
  assert.equal(normalizeError(Object.assign(new Error('failure'), { code: 4 })).code, 'INTERNAL');
  assert.equal(normalizeError(Object.assign(new Error('no connection'), { code: 6 })).code, 'HOST_UNREACHABLE');
  assert.equal(normalizeError(Object.assign(new Error('connection lost'), { code: 7 })).code, 'HOST_UNREACHABLE');
  assert.equal(normalizeError(Object.assign(new Error('op unsupported'), { code: 8 })).code, 'UNSUPPORTED');
});

test('errors_message_rules_cover_sftp_text_without_code', () => {
  assert.equal(normalizeError(new Error('No such file')).code, 'FILE_NOT_FOUND');
  assert.equal(normalizeError(new Error('Permission denied')).code, 'PERMISSION_DENIED');
  assert.equal(normalizeError(new Error('Connection lost before transfer')).code, 'HOST_UNREACHABLE');
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

test('errors_ssh_auth_level_maps_to_auth_failed', () => {
  const error = normalizeError(
    Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }),
  );

  assert.equal(error.code, 'AUTH_FAILED');
});

test('errors_ssh_timeout_level_maps_to_timeout', () => {
  const error = normalizeError(Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' }));

  assert.equal(error.code, 'TIMEOUT');
});

test('errors_ssh_message_without_level_maps_to_auth_failed', () => {
  const error = normalizeError(new Error('All configured authentication methods failed'));

  assert.equal(error.code, 'AUTH_FAILED');
});

test('errors_info_contains_folded_detail', () => {
  const info = new ProductError('PERMISSION_DENIED', { detail: 'EACCES: permission denied' }).toInfo();

  assert.deepEqual(info, {
    code: 'PERMISSION_DENIED',
    message: '权限不足：这个操作被拒绝',
    next: '换有权限的账号，或调整目标文件权限',
    detail: 'EACCES: permission denied',
  });
});
