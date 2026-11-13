/**
 * 产品错误码：底层异常在边界层翻译成人话，原始错误只进 detail。
 * INTERNAL 是兜底码——没有它，未分类异常只能吞掉或把英文原文抛给用户。
 */

export const PRODUCT_ERRORS = {
  AUTH_FAILED: {
    message: '认证失败：用户名、密码或私钥不匹配',
    next: '核对用户名与密码 / 私钥后重试',
  },
  HOST_UNREACHABLE: {
    message: '连不上主机：网络不通或端口未开放',
    next: '确认主机地址与端口，再试一次',
  },
  HOST_KEY_CHANGED: {
    message: '主机指纹变了，可能是重装或劫持',
    next: '确认主机身份后，再决定是否继续连接',
  },
  TIMEOUT: {
    message: '超时：服务器无响应',
    next: '检查网络后重试',
  },
  PERMISSION_DENIED: {
    message: '权限不足：这个操作被拒绝',
    next: '换有权限的账号，或调整目标文件权限',
  },
  FILE_NOT_FOUND: {
    message: '文件不存在',
    next: '刷新目录后重新选择',
  },
  UNSUPPORTED: {
    message: '当前会话不支持这个操作',
    next: '换一个支持该操作的连接',
  },
  INTERNAL: {
    message: '操作没有完成',
    next: '重试一次；仍然失败请查看详情',
  },
} as const;

export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;

export interface ProductErrorInfo {
  code: ProductErrorCode;
  message: string;
  next: string;
  detail?: string;
}

export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly next: string;
  readonly detail?: string;

  constructor(code: ProductErrorCode, options: { message?: string; next?: string; detail?: string } = {}) {
    super(options.message ?? PRODUCT_ERRORS[code].message);
    this.name = 'ProductError';
    this.code = code;
    // 同一个码在不同场景下的下一步不同（首次确认指纹 vs 指纹变化），允许逐条覆盖。
    this.next = options.next ?? PRODUCT_ERRORS[code].next;
    this.detail = options.detail;
  }

  toInfo(): ProductErrorInfo {
    return { code: this.code, message: this.message, next: this.next, detail: this.detail };
  }
}

const NODE_CODE_MAP: Record<string, ProductErrorCode> = {
  ECONNREFUSED: 'HOST_UNREACHABLE',
  EHOSTUNREACH: 'HOST_UNREACHABLE',
  ENETUNREACH: 'HOST_UNREACHABLE',
  EAI_AGAIN: 'HOST_UNREACHABLE',
  ENOTFOUND: 'HOST_UNREACHABLE',
  ECONNRESET: 'HOST_UNREACHABLE',
  ECONNABORTED: 'HOST_UNREACHABLE',
  EPIPE: 'HOST_UNREACHABLE',
  ETIMEDOUT: 'TIMEOUT',
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED',
  ENOENT: 'FILE_NOT_FOUND',
};

// SFTP 状态码随 SSH 协议固定：6 / 7 是链路断了，8 是服务器不支持该操作。
const SFTP_STATUS_MAP: Record<number, ProductErrorCode> = {
  2: 'FILE_NOT_FOUND',
  3: 'PERMISSION_DENIED',
  6: 'HOST_UNREACHABLE',
  7: 'HOST_UNREACHABLE',
  8: 'UNSUPPORTED',
};

export function sftpStatusToCode(status: number): ProductErrorCode | undefined {
  return SFTP_STATUS_MAP[status];
}

// ssh2 用 level 标记失败阶段，比错误文案稳定，优先按 level 归类。
const SSH_LEVEL_MAP: Record<string, ProductErrorCode> = {
  'client-authentication': 'AUTH_FAILED',
  'client-timeout': 'TIMEOUT',
  'client-connection': 'HOST_UNREACHABLE',
  'client-socket': 'HOST_UNREACHABLE',
};

const MESSAGE_RULES: Array<[RegExp, ProductErrorCode]> = [
  [/all (?:configured )?authentication methods failed|unable to authenticate|authentication failed/i, 'AUTH_FAILED'],
  [/host key verification failed|host fingerprint/i, 'HOST_KEY_CHANGED'],
  [/cannot parse privatekey|bad passphrase|no passphrase/i, 'AUTH_FAILED'],
  [/timed out|timeout/i, 'TIMEOUT'],
  [/no such file|does not exist/i, 'FILE_NOT_FOUND'],
  [/permission denied/i, 'PERMISSION_DENIED'],
  [/not connected|connection lost|socket hang up|broken pipe/i, 'HOST_UNREACHABLE'],
];

export function normalizeError(raw: unknown): ProductError {
  if (raw instanceof ProductError) return raw;

  const record = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown; level?: unknown; message?: unknown }) : {};
  const nodeCode = typeof record.code === 'string' ? record.code : undefined;
  const sftpStatus = typeof record.code === 'number' ? record.code : undefined;
  const level = typeof record.level === 'string' ? record.level : undefined;
  const detail =
    raw instanceof Error ? raw.message : typeof record.message === 'string' ? record.message : String(raw);

  const mapped = level ? SSH_LEVEL_MAP[level] : undefined;
  if (mapped) return new ProductError(mapped, { detail });

  if (nodeCode && NODE_CODE_MAP[nodeCode]) {
    return new ProductError(NODE_CODE_MAP[nodeCode], { detail });
  }

  if (sftpStatus !== undefined) {
    const mappedStatus = sftpStatusToCode(sftpStatus);
    if (mappedStatus) return new ProductError(mappedStatus, { detail });
  }

  for (const [pattern, code] of MESSAGE_RULES) {
    if (pattern.test(detail)) return new ProductError(code, { detail });
  }

  return new ProductError('INTERNAL', { detail });
}
