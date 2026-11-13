import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransferPort, TransferProgress, TransferTask } from '../../src/core/ports.ts';
import { TransferQueue, type TransferView } from '../../src/services/transfers/queue.ts';

class FakePort implements TransferPort {
  readonly progressHandlers = new Set<(progress: TransferProgress) => void>();
  readonly tasks = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  readonly uploaded: Array<[string, string]> = [];
  readonly downloaded: Array<[string, string]> = [];
  readonly canceled: string[] = [];
  #sequence = 0;

  upload(source: string, target: string): TransferTask {
    this.uploaded.push([source, target]);
    return this.#create();
  }

  download(source: string, target: string): TransferTask {
    this.downloaded.push([source, target]);
    return this.#create();
  }

  cancel(id: string): void {
    this.canceled.push(id);
    this.tasks.get(id)?.reject(new Error('传输已取消'));
  }

  onProgress(handler: (progress: TransferProgress) => void): () => void {
    this.progressHandlers.add(handler);
    return () => this.progressHandlers.delete(handler);
  }

  emit(id: string, transferred: number, total: number): void {
    for (const handler of this.progressHandlers) handler({ id, transferred, total });
  }

  finish(id: string): void {
    this.tasks.get(id)?.resolve();
  }

  fail(id: string, message: string): void {
    this.tasks.get(id)?.reject(new Error(message));
  }

  #create(): TransferTask {
    const id = `port-${++this.#sequence}`;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.tasks.set(id, { resolve, reject });
    return { id, done };
  }
}

function createQueue(maxConcurrent = 1, port: FakePort | null = new FakePort()) {
  const changes: TransferView[] = [];
  const queue = new TransferQueue({
    getPort: () => port,
    maxConcurrent,
    onChange: (task) => changes.push(task),
  });
  return { queue, port, changes };
}

function request(name: string) {
  return {
    sessionId: 'session-1',
    direction: 'upload' as const,
    localPath: `/local/${name}`,
    remotePath: `/remote/${name}`,
    name,
  };
}

function downloadRequest(name: string) {
  return { ...request(name), direction: 'download' as const };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('queue_runs_task_and_marks_done', async () => {
  const { queue, port, changes } = createQueue();
  const view = queue.enqueue(request('a.txt'));

  assert.equal(queue.find(view.id)?.status, 'running');
  assert.deepEqual(port?.uploaded, [['/local/a.txt', '/remote/a.txt']]);

  port?.emit('port-1', 10, 10);
  assert.equal(queue.find(view.id)?.transferred, 10);

  port?.finish('port-1');
  await flush();

  const done = queue.find(view.id);
  assert.equal(done?.status, 'done');
  assert.equal(done?.transferred, 10);
  assert.ok(changes.some((task) => task.status === 'done'));
});

test('queue_failure_can_be_retried', async () => {
  const { queue, port } = createQueue();
  const view = queue.enqueue(request('b.txt'));

  port?.fail('port-1', '磁盘已满');
  await flush();

  assert.equal(queue.find(view.id)?.status, 'failed');
  assert.equal(queue.find(view.id)?.error?.code, 'INTERNAL');
  assert.equal(queue.find(view.id)?.error?.message, '操作没有完成');
  assert.equal(queue.find(view.id)?.error?.detail, '磁盘已满');

  queue.retry(view.id);
  assert.equal(queue.find(view.id)?.status, 'running');
  assert.equal(queue.find(view.id)?.error, undefined);
  assert.equal(port?.uploaded.length, 2);

  port?.finish('port-2');
  await flush();
  assert.equal(queue.find(view.id)?.status, 'done');
});

test('queue_download_passes_remote_then_local_paths', async () => {
  const { queue, port } = createQueue();
  queue.enqueue(downloadRequest('readme.txt'));

  assert.deepEqual(port?.downloaded, [['/remote/readme.txt', '/local/readme.txt']]);
});

test('queue_cancel_queued_task', async () => {
  const { queue, port } = createQueue(1);
  const first = queue.enqueue(request('first.txt'));
  const second = queue.enqueue(request('second.txt'));

  queue.cancel(second.id);
  assert.equal(queue.find(second.id)?.status, 'canceled');

  port?.finish('port-1');
  await flush();

  assert.equal(queue.find(first.id)?.status, 'done');
  assert.equal(queue.find(second.id)?.status, 'canceled');
});

test('queue_cancel_running_task_calls_port_cancel', async () => {
  const { queue, port } = createQueue();
  const view = queue.enqueue(request('c.txt'));

  queue.cancel(view.id);
  await flush();

  assert.equal(queue.find(view.id)?.status, 'canceled');
  assert.deepEqual(port?.canceled, ['port-1']);
});

test('queue_normalizes_transfer_failure_with_path_detail', async () => {
  const { queue, port } = createQueue();
  const view = queue.enqueue(request('missing.txt'));

  const error = Object.assign(new Error('ENOENT: no such file or directory, open /local/missing.txt'), { code: 'ENOENT' });
  port?.tasks.get('port-1')?.reject(error);
  await flush();

  assert.equal(queue.find(view.id)?.status, 'failed');
  assert.equal(queue.find(view.id)?.error?.code, 'FILE_NOT_FOUND');
  assert.equal(queue.find(view.id)?.error?.message, '文件不存在');
  assert.equal(queue.find(view.id)?.error?.next, '刷新目录后重新选择');
  assert.ok(queue.find(view.id)?.error?.detail?.includes('/local/missing.txt'));
});

test('queue_without_session_port_fails', async () => {
  const { queue } = createQueue(1, null);
  const view = queue.enqueue(request('d.txt'));
  await flush();

  assert.equal(queue.find(view.id)?.status, 'failed');
  assert.equal(queue.find(view.id)?.error?.code, 'UNSUPPORTED');
  assert.equal(queue.find(view.id)?.error?.message, '会话已关闭，传输没有完成');
  assert.equal(queue.find(view.id)?.error?.next, '重新打开连接后再传');
});

test('queue_respects_max_concurrent', async () => {
  const { queue, port } = createQueue(2);
  const first = queue.enqueue(request('e.txt'));
  const second = queue.enqueue(request('f.txt'));
  const third = queue.enqueue(request('g.txt'));

  assert.equal(queue.find(first.id)?.status, 'running');
  assert.equal(queue.find(second.id)?.status, 'running');
  assert.equal(queue.find(third.id)?.status, 'queued');

  port?.finish('port-1');
  await flush();
  assert.equal(queue.find(third.id)?.status, 'running');
});

test('queue_set_max_concurrent_pumps_pending_tasks', async () => {
  const { queue, port } = createQueue(1);
  const first = queue.enqueue(request('h.txt'));
  const second = queue.enqueue(request('i.txt'));

  assert.equal(queue.find(second.id)?.status, 'queued');

  queue.setMaxConcurrent(2);
  assert.equal(queue.find(second.id)?.status, 'running');

  queue.setMaxConcurrent(1);
  port?.finish('port-1');
  port?.finish('port-2');
  await flush();
  assert.equal(queue.find(first.id)?.status, 'done');
  assert.equal(queue.find(second.id)?.status, 'done');
});
