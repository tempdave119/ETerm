import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError } from '../../src/core/errors.ts';
import { requireSessionPort } from '../../src/host/session-capability.ts';

test('session_capability_returns_port_when_present', () => {
  const port = { id: 'file-port' };

  const resolved = requireSessionPort(port, { sessionId: 'ssh-1', sessionAlive: true, capability: 'file' });

  assert.equal(resolved, port);
});

test('session_capability_closed_session_points_to_reconnect', () => {
  assert.throws(
    () => requireSessionPort(null, { sessionId: 'ssh-1', sessionAlive: false, capability: 'file' }),
    (error: unknown) =>
      error instanceof ProductError &&
      error.code === 'UNSUPPORTED' &&
      error.message === '会话已关闭，操作没有完成' &&
      error.next === '重新打开这个连接后再试',
  );
});

test('session_capability_missing_sftp_keeps_terminal_usable', () => {
  assert.throws(
    () => requireSessionPort(null, { sessionId: 'ssh-1', sessionAlive: true, capability: 'transfer' }),
    (error: unknown) =>
      error instanceof ProductError &&
      error.code === 'UNSUPPORTED' &&
      error.message === '这台主机没有开启 SFTP，无法传文件' &&
      error.next === '终端仍可正常使用；需要文件操作请换一台主机',
  );
});

test('session_capability_missing_forward_is_reported', () => {
  assert.throws(
    () => requireSessionPort(null, { sessionId: 'ssh-1', sessionAlive: true, capability: 'forward' }),
    (error: unknown) =>
      error instanceof ProductError && error.code === 'UNSUPPORTED' && error.message === '这台主机不支持端口转发',
  );
});
