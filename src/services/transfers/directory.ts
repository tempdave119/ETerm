import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { FilePort } from '../../core/ports.ts';

export const MAX_DIRECTORY_FILES = 1000;

export interface LocalDirectoryFile {
  relativePath: string;
  localPath: string;
}

export interface LocalDirectoryScan {
  directories: string[];
  files: LocalDirectoryFile[];
}

export interface RemoteDirectoryFile {
  relativePath: string;
  remotePath: string;
  name: string;
}

export interface RemoteDirectoryScan {
  directories: string[];
  files: RemoteDirectoryFile[];
}

/** 递归扫描本地目录；相对路径统一用 /，方便拼远端 posix 路径。 */
export async function scanLocalDirectory(root: string): Promise<LocalDirectoryScan> {
  const directories: string[] = [];
  const files: LocalDirectoryFile[] = [];

  const visit = async (dir: string, relative: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
        await visit(full, path);
      } else if (entry.isFile()) {
        files.push({ relativePath: path, localPath: full });
        if (files.length > MAX_DIRECTORY_FILES) {
          throw new Error(`目录文件超过 ${MAX_DIRECTORY_FILES} 个，请分批上传`);
        }
      }
      // 符号链接与特殊文件跳过，避免递归环与不可预期的目标。
    }
  };

  await visit(root, '');
  return { directories, files };
}

/** 远端返回的文件名不可信：空、. / ..、含分隔符一律拒绝，避免拼出目标目录之外的本地路径。 */
export function assertSafeName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new Error(`远端返回了非法文件名（${name || '空'}），已中止目录下载`);
  }
}

/** 落盘前最后一道防线：扫描器已拦过非法名字，这里保证拼出的路径不会越出目标目录。 */
export function resolveLocalTarget(root: string, relative: string): string {
  const target = resolve(root, ...relative.split('/'));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`远端返回了非法路径（${relative}），已中止目录下载`);
  }
  return target;
}

/** 递归扫描远端目录；只走 list，文件路径用 FileEntry.path。 */
export async function scanRemoteDirectory(file: FilePort, root: string): Promise<RemoteDirectoryScan> {
  const directories: string[] = [];
  const files: RemoteDirectoryFile[] = [];

  const visit = async (dir: string, relative: string): Promise<void> => {
    const entries = (await file.list(dir)).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      assertSafeName(entry.name);
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === 'directory') {
        directories.push(path);
        await visit(entry.path, path);
      } else if (entry.type === 'file') {
        files.push({ relativePath: path, remotePath: entry.path, name: entry.name });
        if (files.length > MAX_DIRECTORY_FILES) {
          throw new Error(`目录文件超过 ${MAX_DIRECTORY_FILES} 个，请分批下载`);
        }
      }
    }
  };

  await visit(root, '');
  return { directories, files };
}
