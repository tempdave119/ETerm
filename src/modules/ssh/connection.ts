import ssh2 from 'ssh2';
import type { Client, ClientChannel } from 'ssh2';
import type { Duplex } from 'node:stream';
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
 * 有跳板时先连跳板，再从跳板开一条到目标的 TCP 通道（sock）。
 */
export async function connectSsh(target: SshTarget): Promise<SshConnection> {
  const jump = target.jump ? await connectSsh(target.jump) : null;

  let sock: Duplex | undefined;
  try {
    if (jump) sock = await forwardOut(jump.client, target.host, target.port);
    const client = await openClient(target, sock);

    let jumpClosed = false;
    const closeJump = (): void => {
      if (jumpClosed) return;
      jumpClosed = true;
      jump?.close();
    };
    // 目标连接一断（会话关闭或对端断开），跳板链路跟着释放，避免半开连接堆积。
    client.once('close', closeJump);

    return {
      client,
      close: () => {
        client.end();
        closeJump();
      },
    };
  } catch (error) {
    sock?.destroy();
    jump?.close();
    throw error;
  }
}

async function openClient(target: SshTarget, sock?: Duplex): Promise<Client> {
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
        sock,
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
    // 只有握手阶段真的拿到指纹才能说是「首次确认」或「指纹变化」；
    // 端口拒绝、DNS 失败这类错误根本没走到 hostVerifier，照实归一。
    if (observedFingerprint && !expected) {
      throw new ProductError('HOST_KEY_CHANGED', {
        message: '首次连接需要确认主机指纹',
        detail: `观察到的主机指纹 ${observedFingerprint}`,
        host: target.host,
        port: target.port,
      });
    }
    if (observedFingerprint && fingerprintMismatch) {
      throw new ProductError('HOST_KEY_CHANGED', {
        detail: `主机指纹已变化：${observedFingerprint}`,
        host: target.host,
        port: target.port,
      });
    }
    throw normalizeError(error);
  }

  return client;
}

/** 跳板转发失败是「跳板连不到目标」，不能笼统说成认证失败或超时。 */
function forwardOut(client: Client, host: string, port: number): Promise<ClientChannel> {
  return new Promise<ClientChannel>((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
      if (error) {
        reject(
          new ProductError('HOST_UNREACHABLE', {
            message: '跳板机无法连到目标主机',
            next: '确认目标地址与端口，以及跳板机允许转发',
            detail: `${host}:${port}: ${error.message}`,
          }),
        );
        return;
      }
      resolve(channel);
    });
  });
}
