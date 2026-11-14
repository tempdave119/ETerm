import test from 'node:test';
import assert from 'node:assert/strict';
import { SSH_ALGORITHMS } from '../../src/modules/ssh/algorithms.ts';

/** ssh2 的算法字段允许「数组」或「增删记录」两种形态，白名单用的是数组。 */
function list(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

test('ssh_algorithms_excludes_sha1_and_cbc', () => {
  assert.ok(!list(SSH_ALGORITHMS.serverHostKey).includes('ssh-rsa'));
  assert.ok(!list(SSH_ALGORITHMS.hmac).some((item) => item.toLowerCase().includes('sha1')));
  assert.ok(!list(SSH_ALGORITHMS.cipher).some((item) => item.toLowerCase().includes('cbc')));
  assert.ok(!list(SSH_ALGORITHMS.kex).some((item) => item.toLowerCase().includes('group1-sha1')));
});

test('ssh_algorithms_keeps_modern_choices', () => {
  assert.ok(list(SSH_ALGORITHMS.serverHostKey).includes('ssh-ed25519'));
  assert.ok(list(SSH_ALGORITHMS.serverHostKey).includes('rsa-sha2-256'));
  assert.ok(list(SSH_ALGORITHMS.kex).includes('curve25519-sha256'));
  assert.ok(list(SSH_ALGORITHMS.cipher).includes('aes256-gcm@openssh.com'));
  assert.ok(list(SSH_ALGORITHMS.hmac).includes('hmac-sha2-256-etm@openssh.com'));
});
