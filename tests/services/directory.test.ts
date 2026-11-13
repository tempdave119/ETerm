import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileEntry, FilePort } from '../../src/core/ports.ts';
import { scanLocalDirectory, scanRemoteDirectory } from '../../src/services/transfers/directory.ts';

const EMPTY_FILE = { size: 0, mtimeMs: 0, mode: 0 } as const;

function entry(name: string, path: string, type: FileEntry['type']): FileEntry {
  return { name, path, type, ...EMPTY_FILE };
}

test('directory_scan_local_walks_nested_directories', async () => {
  const root = join(process.cwd(), 'tmp', 'tests', `directory-${randomUUID()}`);
  await mkdir(join(root, 'sub', 'deep'), { recursive: true });
  await writeFile(join(root, 'a.txt'), 'a');
  await writeFile(join(root, 'sub', 'b.txt'), 'b');
  await writeFile(join(root, 'sub', 'deep', 'c.txt'), 'c');

  const scan = await scanLocalDirectory(root);

  assert.deepEqual(scan.directories, ['sub', 'sub/deep']);
  assert.deepEqual(
    scan.files.map((file) => file.relativePath),
    ['a.txt', 'sub/b.txt', 'sub/deep/c.txt'],
  );
  assert.ok(scan.files.every((file) => file.localPath.startsWith(root)));
});

test('directory_scan_remote_walks_nested_directories', async () => {
  const tree: Record<string, FileEntry[]> = {
    '/root': [entry('a.txt', '/root/a.txt', 'file'), entry('sub', '/root/sub', 'directory')],
    '/root/sub': [entry('b.txt', '/root/sub/b.txt', 'file'), entry('deep', '/root/sub/deep', 'directory')],
    '/root/sub/deep': [entry('c.txt', '/root/sub/deep/c.txt', 'file')],
  };
  const file = {
    list: async (path: string) => tree[path] ?? [],
  } as unknown as FilePort;

  const scan = await scanRemoteDirectory(file, '/root');

  assert.deepEqual(scan.directories, ['sub', 'sub/deep']);
  assert.deepEqual(
    scan.files.map((item) => item.relativePath),
    ['a.txt', 'sub/b.txt', 'sub/deep/c.txt'],
  );
  assert.equal(scan.files[2]?.remotePath, '/root/sub/deep/c.txt');
});
