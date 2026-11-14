import test from 'node:test';
import assert from 'node:assert/strict';
import type { FileEntry } from '../../src/shared/ipc.ts';
import {
  formatDate,
  formatEntrySize,
  formatPermission,
  formatSize,
  permissionOf,
  sortEntries,
} from '../../src/shell/file-sort.ts';

function entry(overrides: Partial<FileEntry> & { name: string }): FileEntry {
  return {
    path: `/${overrides.name}`,
    type: 'file',
    size: 0,
    mtimeMs: 0,
    mode: 0o100644,
    ...overrides,
  } as FileEntry;
}

test('file_sort_keeps_directories_first_in_both_directions', () => {
  const list = [
    entry({ name: 'b.txt' }),
    entry({ name: 'zdir', type: 'directory', mode: 0o40755 }),
    entry({ name: 'a.txt' }),
    entry({ name: 'adir', type: 'directory', mode: 0o40755 }),
  ];

  const asc = sortEntries(list, { key: 'name', direction: 'asc' }).map((item) => item.name);
  assert.deepEqual(asc, ['adir', 'zdir', 'a.txt', 'b.txt']);

  const desc = sortEntries(list, { key: 'name', direction: 'desc' }).map((item) => item.name);
  assert.deepEqual(desc, ['zdir', 'adir', 'b.txt', 'a.txt']);
});

test('file_sort_by_size_date_and_permission', () => {
  const list = [
    entry({ name: 'small', size: 10, mtimeMs: 1_000 }),
    entry({ name: 'large', size: 5000, mtimeMs: 3_000 }),
    entry({ name: 'mid', size: 200, mtimeMs: 2_000, mode: 0o100600 }),
  ];

  assert.deepEqual(
    sortEntries(list, { key: 'size', direction: 'asc' }).map((item) => item.name),
    ['small', 'mid', 'large'],
  );
  assert.deepEqual(
    sortEntries(list, { key: 'mtime', direction: 'desc' }).map((item) => item.name),
    ['large', 'mid', 'small'],
  );
  assert.deepEqual(
    sortEntries(list, { key: 'mode', direction: 'asc' }).map((item) => item.name),
    ['mid', 'large', 'small'],
  );
});

test('file_sort_is_stable_on_equal_values', () => {
  const list = [entry({ name: 'b.txt', size: 1 }), entry({ name: 'a.txt', size: 1 })];
  assert.deepEqual(
    sortEntries(list, { key: 'size', direction: 'asc' }).map((item) => item.name),
    ['a.txt', 'b.txt'],
  );
});

test('file_permission_and_size_formatting', () => {
  assert.equal(permissionOf(entry({ name: 'x', mode: 0o100755 })), 0o755);
  assert.equal(formatPermission(0o100755), '755');
  assert.equal(formatPermission(0o40755), '755');
  assert.equal(formatPermission(0o100644), '644');
  assert.equal(formatPermission(0), '—');

  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2.0 KB');
  assert.equal(formatSize(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatEntrySize(entry({ name: 'dir', type: 'directory' })), '—');
  assert.equal(formatEntrySize(entry({ name: 'f', size: 1024 })), '1.0 KB');
});

test('file_date_formatting_handles_missing_mtime', () => {
  assert.equal(formatDate(0), '—');
  assert.match(formatDate(new Date(2026, 10, 14, 9, 30).getTime()), /^2026-11-14$/);
});
