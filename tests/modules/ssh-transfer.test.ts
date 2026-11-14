import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createTransferPort, type SftpTransferLike, type TransferFsLike } from '../../src/modules/ssh/transfer.ts';

function collector(): { chunks: Buffer[]; stream: Writable } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { chunks, stream };
}

/** 取消场景需要一个不会自己结束的源流，否则 pipeline 会在 cancel 前跑完。 */
function pendingReadable(chunk: string): Readable {
  const stream = new Readable({ read() {} });
  stream.push(Buffer.from(chunk));
  return stream;
}

function createFakeFs(files: Map<string, Buffer>, readOverride?: (path: string) => Readable) {
  const written = new Map<string, Buffer[]>();
  const fs: TransferFsLike = {
    createReadStream: (path) => readOverride?.(path) ?? Readable.from([files.get(path) ?? Buffer.alloc(0)]),
    createWriteStream: (path) => {
      const { chunks, stream } = collector();
      written.set(path, chunks);
      return stream;
    },
    stat: async (path) => ({ size: files.get(path)?.length ?? 0 }),
    async rename(from, to) {
      const chunks = written.get(from);
      if (chunks) {
        written.set(to, chunks);
        written.delete(from);
      }
      files.set(to, Buffer.concat(chunks ?? []));
      files.delete(from);
    },
    async unlink(path) {
      written.delete(path);
      files.delete(path);
    },
  };
  return { fs, written };
}

function createFakeSftp(remote: Map<string, Buffer>) {
  const written = new Map<string, Buffer[]>();
  const renamed: Array<[string, string]> = [];
  const removed: string[] = [];
  const sftp: SftpTransferLike = {
    createReadStream: (path) => Readable.from([remote.get(path) ?? Buffer.alloc(0)]),
    createWriteStream: (path) => {
      const { chunks, stream } = collector();
      written.set(path, chunks);
      return stream;
    },
    stat: (path, callback) => callback(null, { size: remote.get(path)?.length ?? 0 }),
    rename(from, to, callback) {
      renamed.push([from, to]);
      const chunks = written.get(from);
      if (chunks) {
        written.set(to, chunks);
        written.delete(from);
      }
      callback(null);
    },
    unlink(path, callback) {
      removed.push(path);
      written.delete(path);
      callback(null);
    },
  };
  return { sftp, written, renamed, removed };
}

test('transfer_upload_writes_temp_then_renames', async () => {
  const files = new Map([['/local/a.txt', Buffer.from('hello')]]);
  const { fs } = createFakeFs(files);
  const { sftp, written, renamed, removed } = createFakeSftp(new Map());
  const port = createTransferPort(sftp, fs);
  const progress: Array<{ transferred: number; total: number }> = [];
  port.onProgress((value) => progress.push({ transferred: value.transferred, total: value.total }));

  const task = port.upload('/local/a.txt', '/remote/a.txt');
  await task.done;

  assert.equal(Buffer.concat(written.get('/remote/a.txt') ?? []).toString(), 'hello');
  assert.equal(written.size, 1, '临时文件应已替换为目标文件');
  assert.equal(removed.length, 0);
  assert.equal(renamed.length, 1);
  const entry = renamed[0];
  assert.ok(entry);
  const [tempPath, targetPath] = entry;
  assert.equal(targetPath, '/remote/a.txt');
  assert.match(tempPath, /^\/remote\/\.a\.txt\.eterm-transfer-\d+\.part$/);
  assert.equal(progress.at(-1)?.transferred, 5);
  assert.equal(progress.at(-1)?.total, 5);
});

test('transfer_upload_keeps_existing_target_until_replace', async () => {
  const files = new Map([['/local/a.txt', Buffer.from('new')]]);
  const { fs } = createFakeFs(files);
  const { sftp, written, renamed } = createFakeSftp(new Map());
  written.set('/remote/a.txt', [Buffer.from('old')]);

  const port = createTransferPort(sftp, fs);
  await port.upload('/local/a.txt', '/remote/a.txt').done;

  assert.equal(Buffer.concat(written.get('/remote/a.txt') ?? []).toString(), 'new');
  assert.equal(renamed.length, 1);
});

test('transfer_upload_zero_byte_file_still_renames', async () => {
  const files = new Map([['/local/empty.txt', Buffer.alloc(0)]]);
  const { fs } = createFakeFs(files);
  const { sftp, written, renamed } = createFakeSftp(new Map());
  const port = createTransferPort(sftp, fs);

  await port.upload('/local/empty.txt', '/remote/empty.txt').done;

  assert.equal((written.get('/remote/empty.txt') ?? []).length, 0);
  assert.equal(renamed.length, 1);
});

test('transfer_upload_falls_back_when_posix_rename_unavailable', async () => {
  const files = new Map([['/local/a.txt', Buffer.from('fallback')]]);
  const { fs } = createFakeFs(files);
  const { sftp, renamed } = createFakeSftp(new Map());
  sftp.ext_openssh_rename = () => {
    throw new Error('Server does not support this extended request');
  };

  const port = createTransferPort(sftp, fs);
  await port.upload('/local/a.txt', '/remote/a.txt').done;

  assert.equal(renamed.length, 1);
});

test('transfer_upload_failure_removes_temp', async () => {
  const files = new Map([['/local/a.txt', Buffer.from('hello')]]);
  const { fs } = createFakeFs(files);
  const { sftp, removed } = createFakeSftp(new Map());
  sftp.createWriteStream = () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('磁盘已满'));
      },
    });

  const port = createTransferPort(sftp, fs);
  const task = port.upload('/local/a.txt', '/remote/a.txt');

  await assert.rejects(task.done, /磁盘已满/);
  assert.ok(removed.some((path) => path.endsWith('.part')));
});

test('transfer_upload_cancel_removes_temp_and_keeps_target', async () => {
  const { fs } = createFakeFs(new Map(), () => pendingReadable('half'));
  const { sftp, written, renamed, removed } = createFakeSftp(new Map());
  written.set('/remote/a.txt', [Buffer.from('old')]);

  const port = createTransferPort(sftp, fs);
  const task = port.upload('/local/a.txt', '/remote/a.txt');
  await new Promise((resolve) => setImmediate(resolve));
  port.cancel(task.id);

  await assert.rejects(task.done, /传输已取消/);
  assert.equal(renamed.length, 0, '取消后不应替换目标');
  assert.equal(Buffer.concat(written.get('/remote/a.txt') ?? []).toString(), 'old');
  assert.ok(removed.some((path) => path.endsWith('.part')));
});

test('transfer_port_pause_holds_progress_until_resume', async () => {
  const stream = new Readable({ read() {} });
  const { fs } = createFakeFs(new Map([['/local/slow.txt', Buffer.alloc(8)]]), () => stream);
  const { sftp } = createFakeSftp(new Map());
  const port = createTransferPort(sftp, fs);
  const progress: number[] = [];
  port.onProgress((value) => progress.push(value.transferred));

  const task = port.upload('/local/slow.txt', '/remote/slow.txt');
  stream.push(Buffer.from('aaaa'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const before = progress.at(-1) ?? 0;
  assert.equal(before, 4, '第一块应先到达计数流');
  port.pause(task.id);
  stream.push(Buffer.from('bbbb'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(progress.at(-1) ?? 0, before, '暂停后不应继续计数');

  port.resume(task.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok((progress.at(-1) ?? 0) > before, '恢复后应继续计数');

  stream.push(null);
  await task.done;
});

test('transfer_download_writes_local_and_uses_remote_size', async () => {
  const files = new Map<string, Buffer>();
  const remote = new Map([['/remote/b.txt', Buffer.from('world!')]]);
  const { fs, written } = createFakeFs(files);
  const { sftp } = createFakeSftp(remote);
  const port = createTransferPort(sftp, fs);
  const progress: Array<{ total: number }> = [];
  port.onProgress((value) => progress.push({ total: value.total }));

  const task = port.download('/remote/b.txt', '/local/b.txt');
  await task.done;

  assert.equal(Buffer.concat(written.get('/local/b.txt') ?? []).toString(), 'world!');
  assert.ok(![...written.keys()].some((path) => path.includes('.part')), '下载完成后不应残留临时文件');
  assert.equal(progress.at(-1)?.total, 6);
});

test('transfer_download_cancel_removes_temp_file', async () => {
  const files = new Map<string, Buffer>();
  const { fs, written } = createFakeFs(files);
  const { sftp } = createFakeSftp(new Map());
  sftp.createReadStream = () => pendingReadable('partial');
  const port = createTransferPort(sftp, fs);

  const task = port.download('/remote/big', '/local/big');
  await new Promise((resolve) => setTimeout(resolve, 50));
  port.cancel(task.id);

  await assert.rejects(task.done, /传输已取消|aborted/);
  assert.equal(written.size, 0, '取消后不应留下临时文件');
});

test('transfer_download_failure_removes_temp_file', async () => {
  const files = new Map<string, Buffer>();
  const { fs, written } = createFakeFs(files);
  const { sftp } = createFakeSftp(new Map());
  sftp.createReadStream = () =>
    Readable.from(
      (async function* () {
        throw new Error('source-boom');
      })(),
    );
  const port = createTransferPort(sftp, fs);

  const task = port.download('/remote/x', '/local/x');

  await assert.rejects(task.done, /source-boom/);
  assert.equal(written.size, 0, '失败后不应留下临时文件');
});
