import { createHash } from 'node:crypto';
import ssh2 from 'ssh2';
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import { ProductError, normalizeError, sftpStatusToCode } from '../../../src/core/errors.ts';
import type { CapabilityModule, SessionHandle } from '../../../src/core/manifest.ts';
import type {
  ExecPort,
  ExecResult,
  ExitInfo,
  FileEntry,
  FileEntryType,
  FilePort,
  SessionOpenOptions,
  SessionPort,
} from '../../../src/core/ports.ts';

/**
 * 第二个 SSH adapter：只用于 M4「换实现界面不动」验证。
 * 不 import src/modules/ssh 的任何文件，连接、终端、执行、SFTP 都自己实现；
 * 只复用 src/core 的产品错误与端口类型。
 */

interface AltTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  hostKeyFingerprint?: string;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
}

const { Client: SshClient } = ssh2;

function fingerprintOf(hostKey: Buffer): string {
  const digest = createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function parseTarget(input: unknown): AltTarget {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProductError('INTERNAL', { message: '连接参数无效', next: '重新保存连接后重试' });
  }
  const record = input as Record<string, unknown>;
  const host = typeof record.host === 'string' ? record.host.trim() : '';
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  if (!host || !username) {
    throw new ProductError('INTERNAL', { message: '连接配置不完整', next: '编辑连接，补全主机与用户名' });
  }

  const target: AltTarget = {
    host,
    username,
    port: typeof record.port === 'number' && Number.isInteger(record.port) ? record.port : 22,
  };
  if (typeof record.password === 'string') target.password = record.password;
  if (typeof record.privateKey === 'string') target.privateKey = record.privateKey;
  if (typeof record.passphrase === 'string') target.passphrase = record.passphrase;
  if (typeof record.agent === 'string') target.agent = record.agent;
  if (typeof record.hostKeyFingerprint === 'string') target.hostKeyFingerprint = record.hostKeyFingerprint;
  if (typeof record.keepaliveInterval === 'number') target.keepaliveInterval = record.keepaliveInterval;
  if (typeof record.keepaliveCountMax === 'number') target.keepaliveCountMax = record.keepaliveCountMax;
  return target;
}

function connect(target: AltTarget): Promise<Client> {
  const client = new SshClient();
  let observedFingerprint = '';
  let fingerprintMismatch = false;
  const expected = target.hostKeyFingerprint;

  client.on('error', () => {});

  return new Promise<Client>((resolve, reject) => {
    client.once('ready', () => resolve(client));
    client.once('error', (error: Error) => {
      client.end();
      if (observedFingerprint && !expected) {
        reject(
          new ProductError('HOST_KEY_CHANGED', {
            message: '首次连接需要确认主机指纹',
            detail: `观察到的主机指纹 ${observedFingerprint}`,
            host: target.host,
            port: target.port,
          }),
        );
        return;
      }
      if (observedFingerprint && fingerprintMismatch) {
        reject(
          new ProductError('HOST_KEY_CHANGED', {
            detail: `主机指纹已变化：${observedFingerprint}`,
            host: target.host,
            port: target.port,
          }),
        );
        return;
      }
      reject(normalizeError(error));
    });

    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      privateKey: target.privateKey,
      passphrase: target.passphrase,
      agent: target.agent,
      readyTimeout: 10_000,
      keepaliveInterval: target.keepaliveInterval ?? 30_000,
      keepaliveCountMax: target.keepaliveCountMax ?? 3,
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
}

function openShell(client: Client, options: SessionOpenOptions): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell({ term: 'xterm-256color', cols: options.cols, rows: options.rows }, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

function createSession(client: Client, stream: ClientChannel): SessionPort {
  const dataHandlers = new Set<(data: string) => void>();
  const exitHandlers = new Set<(info: ExitInfo) => void>();
  let exitInfo: ExitInfo = { code: null };
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    for (const handler of exitHandlers) handler(exitInfo);
  };

  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    for (const handler of dataHandlers) handler(text);
  });
  stream.on('exit', (code: number | null) => {
    exitInfo = { code: typeof code === 'number' ? code : null };
  });
  stream.on('close', finish);
  client.once('close', finish);

  return {
    write: (data) => stream.write(data),
    resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
    close: () => {
      stream.close();
      client.end();
    },
    onData: (handler) => {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onExit: (handler) => {
      exitHandlers.add(handler);
      return () => exitHandlers.delete(handler);
    },
  };
}

function createExec(client: Client): ExecPort {
  return {
    exec: (command) =>
      new Promise<ExecResult>((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) {
            reject(error);
            return;
          }
          let stdout = '';
          let stderr = '';
          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
          });
          stream.on('close', (code: number | null) => {
            resolve({ stdout, stderr, code: typeof code === 'number' ? code : null });
          });
        });
      }),
  };
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function typeOf(entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): FileEntryType {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) return 'symlink';
  return 'other';
}

function mapSftpError(error: Error, path: string): Error {
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'number' ? record.code : undefined;
  const message = typeof record.message === 'string' ? record.message : String(error);
  const mapped = code === undefined ? undefined : sftpStatusToCode(code);
  return mapped ? new ProductError(mapped, { detail: `${path}: ${message}` }) : normalizeError(error);
}

function createFilePort(sftp: SFTPWrapper): FilePort {
  const unsupported = (): never => {
    throw new ProductError('UNSUPPORTED', {
      message: '替换实现暂不支持这个文件操作',
      next: '换回内置 SSH 实现后重试',
    });
  };

  return {
    list: (path) =>
      new Promise<FileEntry[]>((resolve, reject) => {
        sftp.readdir(path, (error, entries) => {
          if (error) {
            reject(mapSftpError(error, path));
            return;
          }
          resolve(
            entries.map((entry) => ({
              name: entry.filename,
              path: joinRemote(path, entry.filename),
              type: typeOf(entry.attrs),
              size: entry.attrs.size ?? 0,
              mtimeMs: (entry.attrs.mtime ?? 0) * 1000,
              mode: entry.attrs.mode ?? 0,
            })),
          );
        });
      }),
    read: (path) =>
      new Promise<Uint8Array>((resolve, reject) => {
        sftp.readFile(path, (error, data) => {
          if (error) {
            reject(mapSftpError(error, path));
            return;
          }
          resolve(new Uint8Array(data));
        });
      }),
    readHead: (path, maxBytes) =>
      new Promise<Uint8Array>((resolve, reject) => {
        sftp.open(path, 'r', (openError, handle) => {
          if (openError) {
            reject(mapSftpError(openError, path));
            return;
          }
          const buffer = Buffer.alloc(maxBytes);
          sftp.read(handle, buffer, 0, maxBytes, 0, (readError, bytesRead) => {
            sftp.close(handle, () => undefined);
            if (readError) {
              reject(mapSftpError(readError, path));
              return;
            }
            resolve(new Uint8Array(buffer.subarray(0, bytesRead ?? 0)));
          });
        });
      }),
    stat: async () => unsupported(),
    mkdir: async () => unsupported(),
    rename: async () => unsupported(),
    remove: async () => unsupported(),
    write: async () => unsupported(),
  };
}

export const sshAltModule: CapabilityModule = {
  id: 'core-ssh-alt',
  kind: 'capability',
  builtin: true,
  apiVersion: '^1.0.0',
  provides: ['session', 'exec', 'file'],
  activation: { onProtocol: 'ssh' },
  setup(ctx) {
    const clients = new Set<Client>();

    async function openSession(options: SessionOpenOptions): Promise<SessionHandle> {
      const target = parseTarget(options.target);
      const client = await connect(target);
      clients.add(client);
      client.once('close', () => clients.delete(client));

      try {
        const stream = await openShell(client, options);
        let file: FilePort | undefined;
        try {
          file = createFilePort(await openSftp(client));
        } catch (error) {
          // 与内置实现一致：SFTP 子系统不可用时保留终端与执行能力。
          ctx.log.warn('替换实现没有拿到 SFTP，降级为终端与执行', error instanceof Error ? error.message : error);
        }

        return {
          session: createSession(client, stream),
          exec: createExec(client),
          ...(file ? { file } : {}),
        };
      } catch (error) {
        clients.delete(client);
        client.end();
        throw normalizeError(error);
      }
    }

    return {
      exports: { openSession },
      dispose: () => {
        for (const client of clients) client.end();
        clients.clear();
      },
    };
  },
};
