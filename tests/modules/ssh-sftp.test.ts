import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError } from '../../src/core/errors.ts';
import { createFilePort, type RemoteStats, type SftpLike } from '../../src/modules/ssh/sftp.ts';

function makeStats(options: { dir?: boolean; size?: number } = {}): RemoteStats {
  return {
    size: options.size ?? 10,
    mtime: 1_700_000_000,
    mode: 0o644,
    isDirectory: () => options.dir === true,
    isFile: () => options.dir !== true,
    isSymbolicLink: () => false,
  };
}

function createFakeSftp() {
  const calls: string[] = [];
  const sftp: SftpLike = {
    readdir(path, callback) {
      calls.push(`readdir:${path}`);
      callback(null, [
        { filename: 'a.txt', attrs: makeStats({ size: 5 }) },
        { filename: 'dir', attrs: makeStats({ dir: true }) },
      ]);
    },
    stat(path, callback) {
      calls.push(`stat:${path}`);
      if (path.endsWith('.missing')) {
        callback(Object.assign(new Error('No such file'), { code: 2 }), makeStats());
        return;
      }
      if (path.endsWith('.denied')) {
        callback(Object.assign(new Error('Permission denied'), { code: 3 }), makeStats());
        return;
      }
      if (path.endsWith('.lost')) {
        callback(Object.assign(new Error('Connection lost'), { code: 6 }), makeStats());
        return;
      }
      if (path.endsWith('.unsupported')) {
        callback(Object.assign(new Error('Operation unsupported'), { code: 8 }), makeStats());
        return;
      }
      callback(null, makeStats({ dir: path.endsWith('/dir') }));
    },
    mkdir(path, callback) {
      calls.push(`mkdir:${path}`);
      callback();
    },
    rename(from, to, callback) {
      calls.push(`rename:${from}->${to}`);
      callback();
    },
    unlink(path, callback) {
      calls.push(`unlink:${path}`);
      callback();
    },
    rmdir(path, callback) {
      calls.push(`rmdir:${path}`);
      callback();
    },
    readFile(path, callback) {
      calls.push(`read:${path}`);
      callback(null, Buffer.from('remote-data'));
    },
    writeFile(path, data, callback) {
      calls.push(`write:${path}:${data.toString('utf8')}`);
      callback();
    },
  };

  return { sftp, calls };
}

test('sftp_list_maps_entries_to_remote_paths_and_types', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  const entries = await port.list('/srv');

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: 'a.txt',
    path: '/srv/a.txt',
    type: 'file',
    size: 5,
    mtimeMs: 1_700_000_000_000,
    mode: 0o644,
  });
  assert.equal(entries[1]?.type, 'directory');
});

test('sftp_list_root_joins_without_double_slash', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  const entries = await port.list('/');

  assert.equal(entries[0]?.path, '/a.txt');
});

test('sftp_stat_reports_directory_type', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  const entry = await port.stat('/srv/dir');

  assert.equal(entry.name, 'dir');
  assert.equal(entry.type, 'directory');
});

test('sftp_remove_uses_rmdir_for_directories_and_unlink_for_files', async () => {
  const { sftp, calls } = createFakeSftp();
  const port = createFilePort(sftp);

  await port.remove('/srv/dir');
  await port.remove('/srv/a.txt');

  assert.ok(calls.includes('rmdir:/srv/dir'));
  assert.ok(calls.includes('unlink:/srv/a.txt'));
});

test('sftp_read_and_write_delegate_to_sftp', async () => {
  const { sftp, calls } = createFakeSftp();
  const port = createFilePort(sftp);

  const data = await port.read('/srv/a.txt');
  await port.write('/srv/b.txt', new Uint8Array(Buffer.from('hello')));

  assert.equal(Buffer.from(data).toString('utf8'), 'remote-data');
  assert.ok(calls.includes('read:/srv/a.txt'));
  assert.ok(calls.includes('write:/srv/b.txt:hello'));
});

test('sftp_missing_file_maps_to_file_not_found', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  await assert.rejects(
    port.stat('/srv/.missing'),
    (error: unknown) => error instanceof ProductError && error.code === 'FILE_NOT_FOUND',
  );
});

test('sftp_permission_error_maps_to_permission_denied', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  await assert.rejects(
    port.stat('/srv/.denied'),
    (error: unknown) => error instanceof ProductError && error.code === 'PERMISSION_DENIED',
  );
});

test('sftp_connection_lost_maps_to_host_unreachable', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  await assert.rejects(
    port.stat('/srv/.lost'),
    (error: unknown) => error instanceof ProductError && error.code === 'HOST_UNREACHABLE',
  );
});

test('sftp_unsupported_operation_maps_to_unsupported', async () => {
  const { sftp } = createFakeSftp();
  const port = createFilePort(sftp);

  await assert.rejects(
    port.stat('/srv/.unsupported'),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
});
