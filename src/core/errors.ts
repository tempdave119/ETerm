/**
 * 产品错误码：底层异常在边界层翻译成人话，原始错误只进 detail。
 * INTERNAL 是兜底码——没有它，未分类异常只能吞掉或把英文原文抛给用户。
 */

export const PRODUCT_ERRORS = {
  AUTH_FAILED: {
    message: '认证失败：用户名或密钥不匹配',
    next: '检查用户名与密钥后重试',
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
    message: '权限不足：远端拒绝了这次操作',
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

  constructor(code: ProductErrorCode, options: { message?: string; detail?: string } = {}) {
    super(options.message ?? PRODUCT_ERRORS[code].message);
    this.name = 'ProductError';
    this.code = code;
    this.next = PRODUCT_ERRORS[code].next;
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
  ETIMEDOUT: 'TIMEOUT',
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED',
  ENOENT: 'FILE_NOT_FOUND',
};

export function normalizeError(raw: unknown): ProductError {
  if (raw instanceof ProductError) return raw;

  const record = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown; message?: unknown }) : {};
  const nodeCode = typeof record.code === 'string' ? record.code : undefined;
  const detail =
    raw instanceof Error ? raw.message : typeof record.message === 'string' ? record.message : String(raw);

  return new ProductError(nodeCode ? (NODE_CODE_MAP[nodeCode] ?? 'INTERNAL') : 'INTERNAL', { detail });
}
