import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { ProductError } from '../../src/core/errors.ts';
import { connectViaProxy } from '../../src/modules/ssh/proxy.ts';

const servers: Array<http.Server | net.Server> = [];

async function listen<T extends http.Server | net.Server>(server: T): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

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

function readOnce(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once('data', resolve);
    socket.once('error', reject);
  });
}

async function createEchoTarget(): Promise<number> {
  const server = net.createServer((socket) => socket.pipe(socket));
  return listen(server);
}

function attachHttpProxy(server: http.Server, onConnect?: (client: Duplex) => boolean): void {
  server.on('connect', (request, clientSocket, head) => {
    if (onConnect && onConnect(clientSocket)) return;
    const [host, portText] = (request.url ?? '').split(':');
    const upstream = net.connect(Number(portText), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
}

test('proxy_http_connect_tunnels_bytes', async () => {
  const targetPort = await createEchoTarget();
  const proxy = http.createServer();
  attachHttpProxy(proxy);
  const proxyPort = await listen(proxy);

  const socket = await connectViaProxy({ type: 'http', host: '127.0.0.1', port: proxyPort }, '127.0.0.1', targetPort);
  socket.resume();
  socket.write('ping');
  assert.equal((await readOnce(socket)).toString(), 'ping');
  socket.destroy();
});

test('proxy_http_rejection_is_reported', async () => {
  const proxy = http.createServer();
  attachHttpProxy(proxy, (client) => {
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return true;
  });
  const proxyPort = await listen(proxy);

  await assert.rejects(
    connectViaProxy({ type: 'http', host: '127.0.0.1', port: proxyPort }, '127.0.0.1', 22),
    (error: unknown) => error instanceof ProductError && error.message === '代理拒绝了连接',
  );
});

test('proxy_socks5_tunnels_bytes', async () => {
  const targetPort = await createEchoTarget();
  const socks = net.createServer((client) => {
    client.once('data', () => {
      client.write(Buffer.from([0x05, 0x00]));
      client.once('data', (request: Buffer) => {
        const atyp = request[3];
        let host: string;
        let offset: number;
        if (atyp === 0x01) {
          host = [...request.subarray(4, 8)].join('.');
          offset = 8;
        } else {
          const length = request[4] ?? 0;
          host = request.subarray(5, 5 + length).toString('utf8');
          offset = 5 + length;
        }
        const port = request.readUInt16BE(offset);
        const upstream = net.connect(port, host, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
      });
    });
  });
  const socksPort = await listen(socks);

  const socket = await connectViaProxy({ type: 'socks5', host: '127.0.0.1', port: socksPort }, '127.0.0.1', targetPort);
  socket.resume();
  socket.write('pong');
  assert.equal((await readOnce(socket)).toString(), 'pong');
  socket.destroy();
});

test('proxy_socks5_rejection_is_reported', async () => {
  const socks = net.createServer((client) => {
    client.once('data', () => {
      client.write(Buffer.from([0x05, 0x00]));
      client.once('data', () => {
        client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      });
    });
  });
  const socksPort = await listen(socks);

  await assert.rejects(
    connectViaProxy({ type: 'socks5', host: '127.0.0.1', port: socksPort }, '127.0.0.1', 22),
    (error: unknown) => error instanceof ProductError && error.message === '代理拒绝了连接',
  );
});

test('proxy_unreachable_is_reported', async () => {
  await assert.rejects(
    connectViaProxy({ type: 'http', host: '127.0.0.1', port: 1 }, '127.0.0.1', 22),
    (error: unknown) => error instanceof ProductError && error.message === '连不上代理',
  );
});

test('proxy_http_connect_sends_basic_auth', async () => {
  let header = '';
  const proxy = http.createServer();
  proxy.on('connect', (request, socket) => {
    header = String(request.headers['proxy-authorization'] ?? '');
    socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  const proxyPort = await listen(proxy);

  const socket = await connectViaProxy(
    { type: 'http', host: '127.0.0.1', port: proxyPort, username: 'user', password: 'pass' },
    '127.0.0.1',
    22,
  );

  assert.equal(header, `Basic ${Buffer.from('user:pass').toString('base64')}`);
  socket.destroy();
});

test('proxy_socks5_completes_username_password_auth', async () => {
  const targetPort = await createEchoTarget();
  let authFrame: Buffer | null = null;
  const socks = net.createServer((client) => {
    client.once('data', () => {
      client.write(Buffer.from([0x05, 0x02]));
      client.once('data', (auth: Buffer) => {
        authFrame = auth;
        client.write(Buffer.from([0x01, 0x00]));
        client.once('data', (request: Buffer) => {
          const port = request.readUInt16BE(8);
          const upstream = net.connect(port, '127.0.0.1', () => {
            client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            upstream.pipe(client);
            client.pipe(upstream);
          });
          upstream.on('error', () => client.destroy());
        });
      });
    });
  });
  const socksPort = await listen(socks);

  const socket = await connectViaProxy(
    { type: 'socks5', host: '127.0.0.1', port: socksPort, username: 'user', password: 'pass' },
    '127.0.0.1',
    targetPort,
  );
  socket.resume();
  socket.write('pong');
  assert.equal((await readOnce(socket)).toString(), 'pong');
  assert.ok(authFrame);
  const receivedAuth = authFrame as Buffer;
  assert.equal(
    receivedAuth.equals(Buffer.from([0x01, 4, 117, 115, 101, 114, 4, 112, 97, 115, 115])),
    true,
    '认证帧应包含用户名与密码',
  );
  socket.destroy();
});
