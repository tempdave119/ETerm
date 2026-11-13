export interface SshTarget {
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`SSH 连接参数 ${field} 无效`);
  }
  return value;
}

/** 只校验结构与边界；密码 / 私钥将来由凭据服务在确认后注入，不从渲染层直传。 */
export function parseSshTarget(raw: unknown): SshTarget {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('SSH 连接参数缺失');
  }

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

  return target;
}
