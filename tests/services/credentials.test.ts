import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CredentialStore, type SecretCodec } from '../../src/services/credentials/store.ts';

const base64Codec: SecretCodec = {
  encrypt: async (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: async (payload) => Buffer.from(payload, 'base64').toString('utf8'),
};

async function createStore(codec: SecretCodec = base64Codec) {
  const dir = join(process.cwd(), 'tmp', 'tests', `credentials-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return { dir, store: new CredentialStore({ baseDir: dir, codec, logger: () => {} }) };
}

test('credentials_set_and_get_roundtrip', async () => {
  const { store } = await createStore();

  await store.set('conn-1', 'password', 's3cret');
  const value = await store.get('conn-1', 'password');

  assert.equal(value, 's3cret');
});

test('credentials_missing_returns_null', async () => {
  const { store } = await createStore();

  assert.equal(await store.get('conn-1', 'password'), null);
});

test('credentials_file_is_encrypted_and_owner_only', async () => {
  const { dir, store } = await createStore();
  await store.set('conn-1', 'password', 'plain-text-password');

  const raw = await readFile(join(dir, 'credentials.json'), 'utf8');
  const mode = (await stat(join(dir, 'credentials.json'))).mode & 0o777;

  assert.ok(!raw.includes('plain-text-password'));
  assert.equal(mode, 0o600);
});

test('credentials_persist_after_reload', async () => {
  const { dir, store } = await createStore();
  await store.set('conn-1', 'passphrase', 'key-pass');

  const reloaded = new CredentialStore({ baseDir: dir, codec: base64Codec, logger: () => {} });

  assert.equal(await reloaded.get('conn-1', 'passphrase'), 'key-pass');
});

test('credentials_remove_and_remove_all', async () => {
  const { store } = await createStore();
  await store.set('conn-1', 'password', 'a');
  await store.set('conn-1', 'passphrase', 'b');
  await store.set('conn-2', 'password', 'c');

  await store.remove('conn-1', 'password');
  assert.equal(await store.get('conn-1', 'password'), null);
  assert.equal(await store.get('conn-1', 'passphrase'), 'b');

  await store.removeAll('conn-1');
  assert.equal(await store.get('conn-1', 'passphrase'), null);
  assert.equal(await store.get('conn-2', 'password'), 'c');
});

test('credentials_decrypt_failure_is_reported', async () => {
  const brokenCodec: SecretCodec = {
    encrypt: async () => 'not-decryptable',
    decrypt: async () => {
      throw new Error('keychain changed');
    },
  };
  const { store } = await createStore(brokenCodec);
  await store.set('conn-1', 'password', 'secret');

  await assert.rejects(store.get('conn-1', 'password'), /凭据解密失败/);
});
