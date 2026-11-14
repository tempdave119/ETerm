/**
 * 文件列表的排序与展示格式化：纯函数，便于单测。
 * 目录始终排在文件前，组内按所选列排序；同值时按名称稳定排序。
 */

import type { FileEntry } from '../shared/ipc.ts';

export type FileSortKey = 'name' | 'size' | 'mtime' | 'mode';
export type SortDirection = 'asc' | 'desc';

export interface FileSort {
  key: FileSortKey;
  direction: SortDirection;
}

export function sortEntries(entries: FileEntry[], sort: FileSort): FileEntry[] {
  const directories: FileEntry[] = [];
  const files: FileEntry[] = [];
  for (const entry of entries) (entry.type === 'directory' ? directories : files).push(entry);

  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = (left: FileEntry, right: FileEntry): number => {
    switch (sort.key) {
      case 'size':
        return left.size - right.size;
      case 'mtime':
        return left.mtimeMs - right.mtimeMs;
      case 'mode':
        return permissionOf(left) - permissionOf(right);
      default:
        return left.name.localeCompare(right.name);
    }
  };
  const bySort = (left: FileEntry, right: FileEntry): number =>
    sign * compare(left, right) || left.name.localeCompare(right.name);

  return [...directories.sort(bySort), ...files.sort(bySort)];
}

/** 只取权限位，丢掉文件类型位（0o100755 → 755）。 */
export function permissionOf(entry: FileEntry): number {
  return entry.mode & 0o777;
}

export function formatPermission(mode: number): string {
  if (!mode) return '—';
  return (mode & 0o777).toString(8).padStart(3, '0');
}

export function formatEntrySize(entry: FileEntry): string {
  return entry.type === 'directory' ? '—' : formatSize(entry.size);
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 只显示日期，右栏窄，时间放不下时优先保住「哪一天」。 */
export function formatDate(mtimeMs: number): string {
  if (!mtimeMs) return '—';
  const date = new Date(mtimeMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
