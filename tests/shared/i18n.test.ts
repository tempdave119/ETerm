import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, missingKeys, normalizeLocale, resetMissingKeys, setLocale, t } from '../../src/shared/i18n/index.ts';
import { enUS } from '../../src/shared/i18n/en-US.ts';
import { zhCN } from '../../src/shared/i18n/zh-CN.ts';

test('i18n_normalizes_locale_preference', () => {
  assert.equal(normalizeLocale('system', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLocale('system', 'zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('system', 'en-US'), 'en-US');
  assert.equal(normalizeLocale('system', 'ja-JP'), 'en-US');
  assert.equal(normalizeLocale('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(normalizeLocale('en-US', 'zh-CN'), 'en-US');
});

test('i18n_dictionaries_cover_same_keys', () => {
  assert.deepEqual(Object.keys(enUS).sort(), Object.keys(zhCN).sort());
});

test('i18n_translates_and_interpolates', () => {
  setLocale('zh-CN');
  assert.equal(t('common.cancel'), '取消');
  assert.equal(t('common.times', { count: 3 }), '3 次');

  setLocale('en-US');
  assert.equal(t('common.cancel'), 'Cancel');
  assert.equal(t('common.times', { count: 3 }), '3x');
  assert.equal(t('reconnect.notice', { attempt: 2, max: 3 }), 'Disconnected, reconnecting (2/3)…');

  setLocale('zh-CN');
  assert.equal(getLocale(), 'zh-CN');
});

test('i18n_missing_key_falls_back_and_warns_once', () => {
  resetMissingKeys();
  setLocale('en-US');
  const key = 'missing.key' as never;
  assert.equal(t(key), 'missing.key');
  assert.equal(t(key), 'missing.key');
  assert.deepEqual(missingKeys(), ['missing.key']);
  setLocale('zh-CN');
});
