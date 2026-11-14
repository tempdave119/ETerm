import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ProductError } from '../core/errors.ts';
import type { SessionOpenOptions } from '../core/ports.ts';
import type { SshTarget } from '../modules/ssh/target.ts';
import { defaultConfig, type AppConfig } from '../services/config/schema.ts';
import type { ConnectionStore } from '../services/connections/store.ts';
import type { ConnectionRecord } from '../services/connections/types.ts';
import type { CredentialStore } from '../services/credentials/store.ts';
import type { KnownHostsStore } from '../services/known-hosts/store.ts';

export interface ResolverDeps {
  connections: Pick<ConnectionStore, 'getConnection'>;
  credentials: Pick<CredentialStore, 'get'>;
  knownHosts: Pick<KnownHostsStore, 'get'>;
  config?: { get(): Promise<AppConfig> };
  readKeyFile?: (path: string) => Promise<string>;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export interface ResolveOptions {
  connectionId: string;
  cols: number;
  rows: number;
}

/**
 * 把存储里的连接 + Keychain 里的凭据 + known_hosts 指纹组装成会话参数。
 * 渲染层只传 connectionId，永远拿不到密码与私钥。
 */
export async function resolveOpenOptions(
  options: ResolveOptions,
  deps: ResolverDeps,
): Promise<SessionOpenOptions> {
  const record = await deps.connections.getConnection(options.connectionId);
  if (!record) {
    throw new ProductError('INTERNAL', { message: '连接不存在', next: '刷新会话树后重试', detail: options.connectionId });
  }

  if (record.protocol === 'local') {
    return { protocol: 'local', cols: options.cols, rows: options.rows };
  }

  // 可选组件的协议参数原样透传；宿主不解释字段内容。
  if (record.protocol !== 'ssh') {
    return {
      protocol: record.protocol,
      cols: options.cols,
      rows: options.rows,
      target: record.options ?? {},
    };
  }

  const keepalive = await resolveKeepalive(deps);
  return {
    protocol: 'ssh',
    cols: options.cols,
    rows: options.rows,
    target: await resolveSshTarget(record, deps, [], keepalive),
  };
}

interface KeepaliveConfig {
  intervalMs: number;
  countMax: number;
}

async function resolveKeepalive(deps: ResolverDeps): Promise<KeepaliveConfig> {
  const config = deps.config ? await deps.config.get() : defaultConfig();
  return {
    intervalMs: config.ssh.keepaliveInterval * 1000,
    countMax: config.ssh.keepaliveCountMax,
  };
}

async function resolveSshTarget(
  record: ConnectionRecord,
  deps: ResolverDeps,
  chain: string[] = [],
  keepalive?: KeepaliveConfig,
): Promise<SshTarget> {
  if (!record.host || !record.username) {
    throw new ProductError('INTERNAL', { message: '连接配置不完整', next: '编辑连接，补全主机与用户名', detail: record.id });
  }

  const target: SshTarget = {
    host: record.host,
    port: record.port ?? 22,
    username: record.username,
    keepaliveInterval: keepalive?.intervalMs,
    keepaliveCountMax: keepalive?.countMax,
  };

  const fingerprint = await deps.knownHosts.get(target.host, target.port);
  if (fingerprint) target.hostKeyFingerprint = fingerprint;
  if (record.proxy) {
    target.proxy = { ...record.proxy };
    if (record.proxy.username) {
      const proxyPassword = await deps.credentials.get(record.id, 'proxy-password');
      if (proxyPassword) target.proxy.password = proxyPassword;
    }
  }

  if (record.jumpConnectionId) {
    if (chain.includes(record.id)) {
      throw new ProductError('INTERNAL', {
        message: '跳板链存在循环',
        next: '编辑连接，重新选择跳板机',
        detail: record.jumpConnectionId,
      });
    }
    if (chain.length >= 3) {
      throw new ProductError('INTERNAL', {
        message: '跳板链最多 4 层',
        next: '减少跳板层数后重试',
        detail: record.jumpConnectionId,
      });
    }

    const jumpRecord = await deps.connections.getConnection(record.jumpConnectionId);
    if (!jumpRecord || jumpRecord.protocol !== 'ssh') {
      throw new ProductError('INTERNAL', {
        message: '跳板机连接不存在',
        next: '编辑连接，重新选择跳板机',
        detail: record.jumpConnectionId,
      });
    }
    target.jump = await resolveSshTarget(jumpRecord, deps, [...chain, record.id], keepalive);
  }

  switch (record.auth) {
    case 'password': {
      const password = await deps.credentials.get(record.id, 'password');
      if (!password) {
        throw new ProductError('AUTH_FAILED', {
          message: '这个连接还没有保存密码',
          next: '编辑连接，补上密码后再连',
          detail: '在连接设置里补全密码后重试',
        });
      }
      target.password = password;
      return target;
    }

    case 'key': {
      if (!record.keyPath) {
        throw new ProductError('AUTH_FAILED', {
          message: '这个连接还没有选择私钥',
          next: '编辑连接，选择私钥文件后再连',
          detail: '在连接设置里选择私钥文件后重试',
        });
      }
      target.privateKey = await readPrivateKey(record.keyPath, deps);
      const passphrase = await deps.credentials.get(record.id, 'passphrase');
      if (passphrase) target.passphrase = passphrase;
      return target;
    }

    case 'agent': {
      const agent = (deps.env ?? process.env).SSH_AUTH_SOCK;
      if (!agent) {
        throw new ProductError('AUTH_FAILED', {
          message: '没有可用的 SSH agent',
          next: '启动 ssh-agent，或改用密码 / 私钥',
          detail: '启动 ssh-agent，或改用密码 / 私钥',
        });
      }
      target.agent = agent;
      return target;
    }

    default:
      throw new ProductError('AUTH_FAILED', {
        message: 'SSH 连接需要认证方式',
        next: '编辑连接，选择密码、私钥或 agent',
        detail: '在连接设置里选择密码、私钥或 agent',
      });
  }
}

async function readPrivateKey(keyPath: string, deps: ResolverDeps): Promise<string> {
  const resolved = expandHome(keyPath, deps.homeDir ?? homedir());
  if (!isAbsolute(resolved)) {
    throw new ProductError('AUTH_FAILED', {
      message: '私钥路径必须是绝对路径',
      next: '改成以 / 开头的绝对路径',
      detail: resolved,
    });
  }

  const read = deps.readKeyFile ?? ((path: string) => readFile(path, 'utf8'));
  try {
    return await read(resolved);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProductError('AUTH_FAILED', {
      message: '私钥文件读取失败',
      next: '确认文件路径与权限后重试',
      detail: `${resolved}: ${detail}`,
    });
  }
}

function expandHome(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return join(home, input.slice(2));
  return input;
}
