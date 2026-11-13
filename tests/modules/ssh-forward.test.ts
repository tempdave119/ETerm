import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { ProductError } from '../../src/core/errors.ts';
import { createForwardPort, type ForwardClientLike } from '../../src/modules/ssh/forward.ts';

const servers: net.Server[] = [];

after(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});

async function startEcho(): Promise<number> {
  const server = net.createServer((socket) => socket.pipe(socket));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function readOnce(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    stream.once('data', resolve);
    stream.once('error', reject);
  });
}

type TcpListener = (
  info: { destIP: string; destPort: number },
  accept: () => NodeJS.ReadWriteStream,
  reject: () => void,
) => void;

function createFakeClient() {
  const listeners = new Set<TcpListener>();
  const state = {
    forwarded: [] as Array<{ host: string; port: number }>,
    unforwarded: [] as Array<{ host: string; port: number }>,
    listeners,
  };

  const client = {
    state,
    forwardOut(
      _sourceHost: string,
      _sourcePort: number,
      targetHost: string,
      targetPort: number,
      callback: (error: Error | null | undefined, channel: NodeJS.ReadWriteStream) => void,
    ): void {
      const socket = net.connect(targetPort, targetHost, () => callback(null, socket));
      socket.on('error', (error) => callback(error, undefined as unknown as NodeJS.ReadWriteStream));
    },
    forwardIn(host: string, port: number, callback: (error?: Error | null) => void): void {
      state.forwarded.push({ host, port });
      callback();
    },
    unforwardIn(host: string, port: number, callback?: (error?: Error | null) => void): void {
      state.unforwarded.push({ host, port });
      callback?.();
    },
    on(event: 'tcp connection', listener: TcpListener): void {
      if (event === 'tcp connection') listeners.add(listener);
    },
    removeListener(event: 'tcp connection', listener: TcpListener): void {
      if (event === 'tcp connection') listeners.delete(listener);
    },
    emitTcp(info: { destIP: string; destPort: number }, accept: () => NodeJS.ReadWriteStream): void {
      for (const listener of listeners) listener(info, accept, () => {});
    },
  };

  return client as unknown as ForwardClientLike & typeof client;
}

test('forward_local_listens_and_tunnels_to_target', async () => {
  const targetPort = await startEcho();
  const client = createFakeClient();
  const port = createForwardPort(client);

  const view = await port.open({
    direction: 'local',
    bindHost: '127.0.0.1',
    bindPort: 0,
    targetHost: '127.0.0.1',
    targetPort,
  });

  assert.ok(view.bindPort > 0);
  assert.equal(port.list().length, 1);

  const socket = net.connect(view.bindPort, '127.0.0.1');
  socket.write('ping');
  assert.equal((await readOnce(socket)).toString(), 'ping');
  socket.destroy();

  await port.close(view.id);
  assert.equal(port.list().length, 0);
});

test('forward_local_port_in_use_is_reported', async () => {
  const targetPort = await startEcho();
  const occupied = net.createServer();
  servers.push(occupied);
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const occupiedPort = (occupied.address() as AddressInfo).port;

  const port = createForwardPort(createFakeClient());
  await assert.rejects(
    port.open({
      direction: 'local',
      bindHost: '127.0.0.1',
      bindPort: occupiedPort,
      targetHost: '127.0.0.1',
      targetPort,
    }),
    (error: unknown) => error instanceof ProductError && error.message === '本地端口已被占用',
  );
});

test('forward_remote_registers_and_pipes_connections', async () => {
  const targetPort = await startEcho();
  const client = createFakeClient();
  const port = createForwardPort(client);

  const view = await port.open({
    direction: 'remote',
    bindHost: '127.0.0.1',
    bindPort: 9000,
    targetHost: '127.0.0.1',
    targetPort,
  });

  assert.deepEqual(client.state.forwarded, [{ host: '127.0.0.1', port: 9000 }]);

  const channel = new PassThrough();
  client.emitTcp({ destIP: '127.0.0.1', destPort: 9000 }, () => channel);
  channel.write('pong');
  assert.equal((await readOnce(channel)).toString(), 'pong');

  await port.close(view.id);
  channel.destroy();
  assert.deepEqual(client.state.unforwarded, [{ host: '127.0.0.1', port: 9000 }]);
  assert.equal(client.state.listeners.size, 0);
});

test('forward_rejects_invalid_ports', async () => {
  const port = createForwardPort(createFakeClient());

  await assert.rejects(
    port.open({
      direction: 'remote',
      bindHost: '127.0.0.1',
      bindPort: 0,
      targetHost: '127.0.0.1',
      targetPort: 80,
    }),
    (error: unknown) => error instanceof ProductError && error.message === '监听端口无效',
  );
});
