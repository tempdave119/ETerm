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

function createFakeFs(files: Map<string, Buffer>) {
  const written = new Map<string, Buffer[]>();
  const fs: TransferFsLike = {
    createReadStream: (path) => Readable.from([files.get(path) ?? Buffer.alloc(0)]),
    createWriteStream: (path) => {
      const { chunks, stream } = collector();
      written.set(path, chunks);
      return stream;
    },
    stat: async (path) => ({ size: files.get(path)?.length ?? 0 }),
  };
  return { fs, written };
}

function createFakeSftp(remote: Map<string, Buffer>) {
  const written = new Map<string, Buffer[]>();
  const sftp: SftpTransferLike = {
    createReadStream: (path) => Readable.from([remote.get(path) ?? Buffer.alloc(0)]),
    createWriteStream: (path) => {
      const { chunks, stream } = collector();
      written.set(path, chunks);
      return stream;
    },
    stat: (path, callback) => callback(null, { size: remote.get(path)?.length ?? 0 }),
  };
  return { sftp, written };
}

test('transfer_upload_writes_remote_and_reports_progress', async () => {
  const files = new Map([['/local/a.txt', Buffer.from('hello')]]);
  const remote = new Map<string, Buffer>();
  const { fs } = createFakeFs(files);
  const { sftp, written } = createFakeSftp(remote);
  const port = createTransferPort(sftp, fs);
  const progress: Array<{ transferred: number; total: number }> = [];
  port.onProgress((value) => progress.push({ transferred: value.transferred, total: value.total }));

  const task = port.upload('/local/a.txt', '/remote/a.txt');
  await task.done;

  assert.equal(Buffer.concat(written.get('/remote/a.txt') ?? []).toString(), 'hello');
  assert.equal(progress.at(-1)?.transferred, 5);
  assert.equal(progress.at(-1)?.total, 5);
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
  assert.equal(progress.at(-1)?.total, 6);
});

test('transfer_cancel_rejects_running_task', async () => {
  const files = new Map([['/local/c.txt', Buffer.from('cancel-me')]]);
  const { fs } = createFakeFs(files);
  const { sftp } = createFakeSftp(new Map());
  const port = createTransferPort(sftp, fs);

  const task = port.upload('/local/c.txt', '/remote/c.txt');
  port.cancel(task.id);

  await assert.rejects(task.done, /传输已取消/);
});
