import { safeStorage } from 'electron';
import type { SecretCodec } from '../services/credentials/store.ts';

/** 明文只在 safeStorage 调用边界出现；不可用时直接拒绝，绝不落明文兜底。 */
export function createSafeStorageCodec(): SecretCodec {
  return {
    async encrypt(plain) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new Error('系统钥匙串不可用，无法保存凭据');
      }
      return (await safeStorage.encryptStringAsync(plain)).toString('base64');
    },
    async decrypt(payload) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new Error('系统钥匙串不可用，无法读取凭据');
      }
      return (await safeStorage.decryptStringAsync(Buffer.from(payload, 'base64'))).result;
    },
  };
}
