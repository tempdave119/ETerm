export interface ProxyConfig {
  type: 'http' | 'socks5';
  host: string;
  port: number;
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  /** 直连时经代理开通道；已经走跳板时忽略（流量已经在跳板里）。 */
  proxy?: ProxyConfig;
  /** 毫秒；ssh2 每 N 毫秒发一次 keepalive 全局请求。 */
  keepaliveInterval?: number;
  /** 连续无响应达到上限才断开。 */
  keepaliveCountMax?: number;
  /** 跳板链：先连上 jump，再从它开一条到本目标的 TCP 通道。 */
  jump?: SshTarget;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`SSH 连接参数 ${field} 无效`);
  }
  return value;
}

/** 只校验结构与边界；密码 / 私钥将来由凭据服务在确认后注入，不从渲染层直传。 */
export function parseSshTarget(raw: unknown, depth = 0): SshTarget {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('SSH 连接参数缺失');
  }
  if (depth > 4) throw new Error('跳板链最多 4 层');

  const record = raw as Record<string, unknown>;
  const rawPort = record.port === undefined ? 22 : record.port;
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    throw new Error('SSH 连接参数 port 无效');
  }

  const target: SshTarget = {
    host: readString(record.host, 'host', 255),
    username: readString(record.username, 'username', 255),
    port: rawPort,
  };

  if (record.hostKeyFingerprint !== undefined) {
    target.hostKeyFingerprint = readString(record.hostKeyFingerprint, 'hostKeyFingerprint', 128);
  }
  if (record.password !== undefined) target.password = readString(record.password, 'password', 4096);
  if (record.privateKey !== undefined) target.privateKey = readString(record.privateKey, 'privateKey', 65536);
  if (record.passphrase !== undefined) target.passphrase = readString(record.passphrase, 'passphrase', 4096);
  if (record.agent !== undefined) target.agent = readString(record.agent, 'agent', 4096);
  if (record.keepaliveInterval !== undefined) {
    if (
      typeof record.keepaliveInterval !== 'number' ||
      !Number.isInteger(record.keepaliveInterval) ||
      record.keepaliveInterval < 0 ||
      record.keepaliveInterval > 3_600_000
    ) {
      throw new Error('SSH 连接参数 keepaliveInterval 无效');
    }
    target.keepaliveInterval = record.keepaliveInterval;
  }
  if (record.keepaliveCountMax !== undefined) {
    if (
      typeof record.keepaliveCountMax !== 'number' ||
      !Number.isInteger(record.keepaliveCountMax) ||
      record.keepaliveCountMax < 0 ||
      record.keepaliveCountMax > 100
    ) {
      throw new Error('SSH 连接参数 keepaliveCountMax 无效');
    }
    target.keepaliveCountMax = record.keepaliveCountMax;
  }
  if (record.proxy !== undefined) target.proxy = parseProxyConfig(record.proxy);
  if (record.jump !== undefined) target.jump = parseSshTarget(record.jump, depth + 1);

  return target;
}

function parseProxyConfig(raw: unknown): ProxyConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('代理参数缺失');
  }
  const record = raw as Record<string, unknown>;
  if (record.type !== 'http' && record.type !== 'socks5') {
    throw new Error('代理类型必须是 http 或 socks5');
  }
  const rawPort = record.port;
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    throw new Error('代理端口无效');
  }
  return {
    type: record.type,
    host: readString(record.host, 'proxy.host', 255),
    port: rawPort,
  };
}
