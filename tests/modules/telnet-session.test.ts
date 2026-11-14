import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const telnetComponent = require('../../examples/components/telnet/index.cjs') as {
  setup(ctx: unknown): {
    exports: {
      openSession(options: unknown): Promise<{
        session: {
          write(data: string): void;
          resize(cols: number, rows: number): void;
          close(): void;
          onData(handler: (data: string) => void): () => void;
          onExit(handler: (info: { code: number | null; reason?: string }) => void): () => void;
        };
      }>;
    };
    dispose(): void;
  };
};

const IAC = 255;
const WILL = 251;
const DO = 253;
const SB = 250;
const SE = 240;
const OPTION_NAWS = 31;
const OPTION_TTYPE = 24;

async function waitUntil(check: () => boolean, label: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(`等待超时：${label}`);
}

test('telnet_component_opens_session_and_echoes_data', async () => {
  let received = Buffer.alloc(0);
  let echoed = false;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('telnet-ready\r\n');
    socket.write(Buffer.from([IAC, DO, OPTION_NAWS]));
    socket.write(Buffer.from([IAC, SB, OPTION_TTYPE, 1, IAC, SE]));
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (!echoed && received.includes(Buffer.from('hello\r\n'))) {
        echoed = true;
        socket.write('server-echo\r\n');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const setup = telnetComponent.setup({ log: { info() {}, warn() {} } });

  try {
    const handle = await setup.exports.openSession({
      protocol: 'telnet',
      cols: 80,
      rows: 24,
      target: { host: '127.0.0.1', port: String(port) },
    });

    let output = '';
    let exit: { code: number | null; reason?: string } | null = null;
    handle.session.onData((data) => {
      output += data;
    });
    handle.session.onExit((info) => {
      exit = info;
    });

    await waitUntil(() => output.includes('telnet-ready'), '首屏 banner');
    await waitUntil(() => received.includes(Buffer.from([IAC, WILL, OPTION_NAWS])), 'WILL NAWS');
    await waitUntil(() => received.includes(Buffer.from('xterm-256color')), 'TTYPE IS');

    handle.session.resize(100, 40);
    await waitUntil(
      () => received.includes(Buffer.from([IAC, SB, OPTION_NAWS, 0, 100, 0, 40, IAC, SE])),
      'NAWS 尺寸',
    );

    handle.session.write('hello\r');
    await waitUntil(() => received.includes(Buffer.from('hello\r\n')), '写入 CRLF');
    await waitUntil(() => output.includes('server-echo'), '服务端回显');

    handle.session.close();
    await waitUntil(() => exit !== null, '会话退出');
    assert.deepEqual(exit, { code: 0, reason: 'closed' });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
