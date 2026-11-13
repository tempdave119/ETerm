import { ProductError } from '../core/errors.ts';

/**
 * 端口缺失有两种原因，用户要做的下一步完全不同：
 * 会话已经关掉（重开连接就行）vs 这台主机没有 SFTP（终端还能用）。
 */
export function requireSessionPort<T>(
  port: T | null,
  context: { sessionId: string; sessionAlive: boolean; capability: 'file' | 'transfer' | 'forward' | 'exec' },
): T {
  if (port) return port;

  if (!context.sessionAlive) {
    throw new ProductError('UNSUPPORTED', {
      message: '会话已关闭，操作没有完成',
      next: '重新打开这个连接后再试',
      detail: context.sessionId,
    });
  }

  const message =
    context.capability === 'file'
      ? '这台主机没有开启 SFTP，文件面板不可用'
      : context.capability === 'transfer'
        ? '这台主机没有开启 SFTP，无法传文件'
        : context.capability === 'exec'
          ? '当前会话不支持远端执行，无法采集远端资源'
          : '这台主机不支持端口转发';
  const next =
    context.capability === 'file' || context.capability === 'transfer'
      ? '终端仍可正常使用；需要文件操作请换一台主机'
      : context.capability === 'exec'
        ? '终端仍可正常使用；需要远端监控请换一台主机'
        : '终端仍可正常使用；需要端口转发请换一台主机';
  throw new ProductError('UNSUPPORTED', { message, next });
}
