/**
 * 产品错误码：底层异常在边界层翻译成人话，原始错误只进 detail。
 * INTERNAL 是兜底码——没有它，未分类异常只能吞掉或把英文原文抛给用户。
 * 文案本身在 shared/i18n，这里只存 key，保证主进程与渲染层跟随界面语言。
 */

import { t } from '../shared/i18n/index.ts';

export const PRODUCT_ERRORS = {
  AUTH_FAILED: {
    message: 'error.auth.message',
    next: 'error.auth.next',
  },
  HOST_UNREACHABLE: {
    message: 'error.unreachable.message',
    next: 'error.unreachable.next',
  },
  HOST_KEY_CHANGED: {
    message: 'error.hostKey.message',
    next: 'error.hostKey.next',
  },
  TIMEOUT: {
    message: 'error.timeout.message',
    next: 'error.timeout.next',
  },
  PERMISSION_DENIED: {
    message: 'error.permission.message',
    next: 'error.permission.next',
  },
  FILE_NOT_FOUND: {
    message: 'error.notFound.message',
    next: 'error.notFound.next',
  },
  UNSUPPORTED: {
    message: 'error.unsupported.message',
    next: 'error.unsupported.next',
  },
  INTERNAL: {
    message: 'error.internal.message',
    next: 'error.internal.next',
  },
} as const;

export type ProductErrorCode = keyof typeof PRODUCT_ERRORS;

export interface ProductErrorInfo {
  code: ProductErrorCode;
  message: string;
  next: string;
  detail?: string;
  /** 同一错误码下的细分原因（如指纹首次 / 变更），供界面做分支判断。 */
  reason?: string;
  /** 指纹确认等场景需要知道是哪一跳主机失败；其余错误不带。 */
  host?: string;
  port?: number;
  /** 本次握手观察到的主机指纹；结构化携带，避免界面从 detail 文本里正则抠取。 */
  fingerprint?: string;
  /** 指纹变更场景下的旧指纹，供弹窗对比展示。 */
  previousFingerprint?: string;
}

export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly detail?: string;
  readonly reason?: string;
  readonly host?: string;
  readonly port?: number;
  readonly fingerprint?: string;
  readonly previousFingerprint?: string;
  readonly #customMessage?: string;
  readonly #customNext?: string;

  constructor(
    code: ProductErrorCode,
    options: {
      message?: string;
      next?: string;
      detail?: string;
      reason?: string;
      host?: string;
      port?: number;
      fingerprint?: string;
      previousFingerprint?: string;
    } = {},
  ) {
    super(options.message ?? t(PRODUCT_ERRORS[code].message));
    this.name = 'ProductError';
    this.code = code;
    this.#customMessage = options.message;
    // 同一个码在不同场景下的下一步不同（首次确认指纹 vs 指纹变化），允许逐条覆盖。
    this.#customNext = options.next;
    this.detail = options.detail;
    this.reason = options.reason;
    this.host = options.host;
    this.port = options.port;
    this.fingerprint = options.fingerprint;
    this.previousFingerprint = options.previousFingerprint;
  }

  /** 按当前语言取下一步；没有逐条覆盖时读字典。 */
  get next(): string {
    return this.#customNext ?? t(PRODUCT_ERRORS[this.code].next);
  }

  toInfo(): ProductErrorInfo {
    const info: ProductErrorInfo = {
      code: this.code,
      message: this.#customMessage ?? t(PRODUCT_ERRORS[this.code].message),
      next: this.next,
      detail: this.detail,
    };
    if (this.reason !== undefined) info.reason = this.reason;
    if (this.host !== undefined) info.host = this.host;
    if (this.port !== undefined) info.port = this.port;
    if (this.fingerprint !== undefined) info.fingerprint = this.fingerprint;
    if (this.previousFingerprint !== undefined) info.previousFingerprint = this.previousFingerprint;
    return info;
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

  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as {
          code?: unknown;
          level?: unknown;
          message?: unknown;
          next?: unknown;
          detail?: unknown;
          reason?: unknown;
          host?: unknown;
          port?: unknown;
        })
      : {};
  const nodeCode = typeof record.code === 'string' ? record.code : undefined;
  const sftpStatus = typeof record.code === 'number' ? record.code : undefined;
  const level = typeof record.level === 'string' ? record.level : undefined;
  const detail =
    raw instanceof Error ? raw.message : typeof record.message === 'string' ? record.message : String(raw);

  // 外挂组件拿不到宿主的 ProductError 类，按形状识别产品码；
  // 不这样做，组件报的 HOST_KEY_CHANGED 等会被降级成 INTERNAL。
  if (nodeCode && Object.hasOwn(PRODUCT_ERRORS, nodeCode)) {
    return new ProductError(nodeCode as ProductErrorCode, {
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
      ...(typeof record.next === 'string' ? { next: record.next } : {}),
      ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(typeof record.host === 'string' ? { host: record.host } : {}),
      ...(typeof record.port === 'number' ? { port: record.port } : {}),
    });
  }

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
