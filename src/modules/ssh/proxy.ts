import net from 'node:net';
import { ProductError } from '../../core/errors.ts';
import type { ProxyConfig } from './target.ts';

const MAX_HEADER = 16 * 1024;

/**
 * 通过代理打开一条到目标的 TCP 通道，返回的 socket 直接交给 ssh2 的 `sock`。
 * 握手结束后 socket 保持 paused：ssh2 会自己 pause / 挂监听 / resume，
 * 这样代理响应头之后紧跟的 SSH banner 不会在交接间隙丢掉。
 */
export function connectViaProxy(proxy: ProxyConfig, host: string, port: number): Promise<net.Socket> {
  return proxy.type === 'http' ? httpConnect(proxy, host, port) : socks5Connect(proxy, host, port);
}

function proxyFailure(message: string, detail: string): ProductError {
  return new ProductError('HOST_UNREACHABLE', {
    message,
    next: '检查代理地址、端口与允许转发的目标',
    detail,
  });
}

function httpConnect(proxy: ProxyConfig, host: string, port: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let buffer = Buffer.alloc(0);
    let settled = false;

    const fail = (error: ProductError): void => {
      if (settled) return;
      settled = true;
      socket.removeListener('data', onData);
      socket.destroy();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buffer.length > MAX_HEADER) fail(proxyFailure('代理响应异常', '响应头超过 16 KB'));
        return;
      }

      const head = buffer.subarray(0, end).toString('latin1');
      const statusLine = head.split('\r\n')[0] ?? '';
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
      if (!status || status[1] !== '200') {
        fail(proxyFailure('代理拒绝了连接', statusLine || '响应状态行缺失'));
        return;
      }

      settled = true;
      socket.removeListener('data', onData);
      socket.pause();
      const rest = buffer.subarray(end + 4);
      if (rest.length > 0) socket.unshift(rest);
      resolve(socket);
    };

    socket.on('data', onData);
    socket.once('error', (error) => fail(proxyFailure('连不上代理', error.message)));
    socket.once('connect', () => {
      const authorization = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}\r\n`
        : '';
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${authorization}\r\n`);
    });
  });
}

function socks5Connect(proxy: ProxyConfig, host: string, port: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting';
    let settled = false;

    const fail = (error: ProductError): void => {
      if (settled) return;
      settled = true;
      socket.removeListener('data', onData);
      socket.destroy();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        if (buffer[0] !== 0x05) {
          fail(proxyFailure('代理响应异常', `协商首字节 ${buffer[0] ?? 0}`));
          return;
        }
        const method = buffer[1] ?? 0xff;
        buffer = buffer.subarray(2);
        if (method === 0x00) {
          stage = 'connect';
          socket.write(buildSocks5Request(host, port));
          return;
        }
        if (method === 0x02 && proxy.username) {
          stage = 'auth';
          socket.write(buildSocks5Auth(proxy.username, proxy.password ?? ''));
          return;
        }
        fail(proxyFailure('代理不支持可用的 SOCKS5 认证', `协商结果 05${method.toString(16)}`));
        return;
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const version = buffer[0];
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (version !== 0x01) {
          fail(proxyFailure('代理认证响应异常', `版本 ${version}`));
          return;
        }
        if (status !== 0x00) {
          fail(proxyFailure('代理认证失败', `SOCKS5 认证状态 ${status}`));
          return;
        }
        stage = 'connect';
        socket.write(buildSocks5Request(host, port));
        return;
      }

      const reply = readSocks5Reply(buffer);
      if (!reply) {
        if (buffer.length > MAX_HEADER) fail(proxyFailure('代理响应异常', 'SOCKS5 响应过大'));
        return;
      }
      if (reply.status !== 0) {
        fail(proxyFailure('代理拒绝了连接', `SOCKS5 状态 ${reply.status}`));
        return;
      }

      settled = true;
      socket.removeListener('data', onData);
      socket.pause();
      if (reply.rest.length > 0) socket.unshift(reply.rest);
      resolve(socket);
    };

    socket.on('data', onData);
    socket.once('error', (error) => fail(proxyFailure('连不上代理', error.message)));
    socket.once('connect', () => {
      // 有凭据时把「用户名密码」作为可接受方法排在免认证之后。
      const methods = proxy.username
        ? Buffer.from([0x05, 0x02, 0x00, 0x02])
        : Buffer.from([0x05, 0x01, 0x00]);
      socket.write(methods);
    });
  });
}

function buildSocks5Auth(username: string, password: string): Buffer {
  const user = Buffer.from(username, 'utf8');
  const pass = Buffer.from(password, 'utf8');
  if (user.length === 0 || user.length > 255 || pass.length > 255) {
    throw new Error('SOCKS5 用户名需为 1–255 字节，密码不超过 255 字节');
  }
  return Buffer.concat([
    Buffer.from([0x01, user.length]),
    user,
    Buffer.from([pass.length]),
    pass,
  ]);
}

function buildSocks5Request(host: string, port: number): Buffer {
  const { atyp, bytes } = encodeAddress(host);
  const request = Buffer.alloc(4 + bytes.length + 2);
  request[0] = 0x05;
  request[1] = 0x01;
  request[2] = 0x00;
  request[3] = atyp;
  bytes.copy(request, 4);
  request.writeUInt16BE(port, 4 + bytes.length);
  return request;
}

function encodeAddress(host: string): { atyp: number; bytes: Buffer } {
  const octets = host.split('.');
  if (octets.length === 4 && octets.every((item) => /^\d{1,3}$/.test(item) && Number(item) <= 255)) {
    return { atyp: 0x01, bytes: Buffer.from(octets.map(Number)) };
  }
  const name = Buffer.from(host, 'utf8');
  if (name.length > 255) throw new Error('目标主机名超过 255 字节');
  return { atyp: 0x03, bytes: Buffer.concat([Buffer.from([name.length]), name]) };
}

function readSocks5Reply(
  buffer: Buffer,
): { status: number; rest: Buffer } | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0x05) return { status: 0xff, rest: Buffer.alloc(0) };

  const status = buffer[1] ?? 0xff;
  const atyp = buffer[3];
  let offset = 4;
  if (atyp === 0x01) offset += 4;
  else if (atyp === 0x03) {
    if (buffer.length < 5) return null;
    offset += 1 + (buffer[4] ?? 0);
  } else if (atyp === 0x04) offset += 16;
  else return { status: 0xff, rest: Buffer.alloc(0) };

  offset += 2;
  if (buffer.length < offset) return null;
  return { status, rest: buffer.subarray(offset) };
}
