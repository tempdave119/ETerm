/**
 * 本地终端的启动命令解析：纯函数，放在 shared 供宿主与本地终端模块共用。
 * 空值保持系统默认登录 shell；非空统一交给登录 sh 执行，
 * 引号、管道、`fish -l`、`tmux attach` 都不需要宿主解析。
 */

export interface LocalLaunch {
  file: string;
  args: string[];
}

export function resolveLocalCommand(
  command: string | null | undefined,
  fallbackShell: string,
): LocalLaunch {
  const trimmed = (command ?? '').trim();
  if (!trimmed) return { file: fallbackShell, args: ['-l'] };
  return { file: '/bin/sh', args: ['-lc', trimmed] };
}

/** 会话 target 里的 `command` 字段，非字符串一律当空值。 */
export function commandFromTarget(target: unknown): string {
  if (typeof target !== 'object' || target === null) return '';
  const value = (target as { command?: unknown }).command;
  return typeof value === 'string' ? value : '';
}
