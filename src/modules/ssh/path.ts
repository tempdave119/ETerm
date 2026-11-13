import { posix } from 'node:path';

/** 远端路径一律按 POSIX 处理，不用宿主机的分隔符。 */
export function joinRemote(base: string, name: string): string {
  if (!base || base === '/') return `/${name}`;
  return posix.join(base, name);
}

export function baseName(remotePath: string): string {
  return posix.basename(remotePath) || remotePath;
}
