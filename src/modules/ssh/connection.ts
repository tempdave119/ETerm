import ssh2 from 'ssh2';
import type { Client } from 'ssh2';
import { ProductError, normalizeError } from '../../core/errors.ts';
import { fingerprintOf } from './fingerprint.ts';
import type { SshTarget } from './target.ts';

const { Client: SshClient } = ssh2;

export interface SshConnection {
  client: Client;
  close(): void;
}

/**
 * 一条 SSH 连接承载一个会话的终端、执行与文件端口。
 * 首次连接没有指纹时一律拒绝，把观察到的指纹交给上层确认，不做 TOFU 静默信任。
 */
export async function connectSsh(target: SshTarget): Promise<SshConnection> {
  const client = new SshClient();
  let observedFingerprint = '';
  let fingerprintMismatch = false;
  const expected = target.hostKeyFingerprint;

  // 连接期错误由 Promise 处理；运行期错误保留一个监听，避免 EventEmitter 直接抛崩。
  client.on('error', () => {});

  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        privateKey: target.privateKey,
        passphrase: target.passphrase,
        agent: target.agent,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
        hostVerifier: (key: Buffer) => {
          observedFingerprint = fingerprintOf(key);
          if (!expected) return false;
          if (observedFingerprint !== expected) {
            fingerprintMismatch = true;
            return false;
          }
          return true;
        },
      });
    });
  } catch (error) {
    client.end();
    if (!expected) {
      throw new ProductError('HOST_KEY_CHANGED', {
        message: '首次连接需要确认主机指纹',
        detail: observedFingerprint ? `观察到的主机指纹 ${observedFingerprint}` : undefined,
      });
    }
    if (fingerprintMismatch) {
      throw new ProductError('HOST_KEY_CHANGED', { detail: `主机指纹已变化：${observedFingerprint}` });
    }
    throw normalizeError(error);
  }

  return { client, close: () => client.end() };
}
