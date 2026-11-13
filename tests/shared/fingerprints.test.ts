import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFingerprint } from '../../src/shared/fingerprints.ts';

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('fingerprint_extracts_from_observed_message', () => {
  assert.equal(extractFingerprint(`观察到的主机指纹 ${FINGERPRINT}`), FINGERPRINT);
});

test('fingerprint_extracts_from_changed_message', () => {
  assert.equal(extractFingerprint(`主机指纹已变化：${FINGERPRINT}`), FINGERPRINT);
});

test('fingerprint_returns_null_when_absent', () => {
  assert.equal(extractFingerprint('连接超时'), null);
});
