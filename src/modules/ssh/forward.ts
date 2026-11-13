import net from 'node:net';
import type { Duplex } from 'node:stream';
import { ProductError } from '../../core/errors.ts';
import type { ForwardPort, ForwardRequest, ForwardView } from '../../core/ports.ts';

/** 只抽用到的方法，测试里可以用普通对象替代 ssh2 Client。 */
export interface ForwardClientLike {
  forwardOut(
    sourceHost: string,
    sourcePort: number,
    targetHost: string,
    targetPort: number,
    callback: (error: Error | null | undefined, channel: Duplex) => void,
  ): void;
  forwardIn(host: string, port: number, callback: (error?: Error | null) => void): void;
  unforwardIn(host: string, port: number, callback?: (error?: Error | null) => void): void;
  on(
    event: 'tcp connection',
    listener: (info: { destIP: string; destPort: number }, accept: () => Duplex, reject: () => void) => void,
  ): void;
  removeListener(
    event: 'tcp connection',
    listener: (info: { destIP: string; destPort: number }, accept: () => Duplex, reject: () => void) => void,
  ): void;
}

interface Task {
  view: ForwardView;
  close(): Promise<void>;
}

/**
 * 本地转发（-L）：本机监听，每个连接从 SSH 通道 forwardOut 到目标。
 * 远程转发（-R）：让服务器在远端监听，收到 tcp connection 时回连本地目标。
 * 转发随会话生命周期：会话关闭时 client 断掉，监听与通道随之释放。
 */
export function createForwardPort(client: ForwardClientLike): ForwardPort {
  const tasks = new Map<string, Task>();
  let sequence = 0;

  return {
    async open(request) {
      const normalized = normalizeRequest(request);
      const view: ForwardView = {
        ...normalized,
        id: `forward-${++sequence}`,
        createdAt: new Date().toISOString(),
      };

      if (normalized.direction === 'local') {
        const server = net.createServer((socket) => {
          client.forwardOut('127.0.0.1', 0, normalized.targetHost, normalized.targetPort, (error, channel) => {
            if (error) {
              socket.destroy();
              return;
            }
            socket.pipe(channel).pipe(socket);
            socket.on('error', () => channel.destroy());
            channel.on('error', () => socket.destroy());
            socket.on('close', () => channel.destroy());
            channel.on('close', () => socket.destroy());
          });
        });
        view.bindPort = await listen(server, normalized.bindHost, normalized.bindPort);
        tasks.set(view.id, {
          view,
          close: async () => {
            // 停止接受新连接；已建立的隧道随会话结束一起释放。
            server.close();
          },
        });
        return { ...view };
      }

      await forwardIn(client, normalized.bindHost, normalized.bindPort);
      const listener = (
        info: { destIP: string; destPort: number },
        accept: () => Duplex,
        reject: () => void,
      ): void => {
        if (info.destPort !== normalized.bindPort) {
          reject();
          return;
        }
        const channel = accept();
        const socket = net.connect(normalized.targetPort, normalized.targetHost, () => {
          socket.pipe(channel).pipe(socket);
        });
        socket.on('error', () => channel.destroy());
        channel.on('error', () => socket.destroy());
        socket.on('close', () => channel.destroy());
        channel.on('close', () => socket.destroy());
      };
      client.on('tcp connection', listener);
      tasks.set(view.id, {
        view,
        close: async () => {
          client.removeListener('tcp connection', listener);
          await unforwardIn(client, normalized.bindHost, normalized.bindPort);
        },
      });
      return { ...view };
    },

    list() {
      return [...tasks.values()].map((task) => ({ ...task.view }));
    },

    async close(id) {
      const task = tasks.get(id);
      if (!task) return;
      tasks.delete(id);
      await task.close();
    },
  };
}

function normalizeRequest(request: ForwardRequest): ForwardRequest {
  if (request.direction !== 'local' && request.direction !== 'remote') {
    throw new ProductError('INTERNAL', { message: '转发方向无效', next: '选择本地或远程转发' });
  }
  const bindHost = request.bindHost.trim() || '127.0.0.1';
  const minBindPort = request.direction === 'local' ? 0 : 1;
  return {
    direction: request.direction,
    bindHost,
    bindPort: requirePort(request.bindPort, '监听端口', minBindPort),
    targetHost: requireHost(request.targetHost, '目标主机'),
    targetPort: requirePort(request.targetPort, '目标端口', 1),
  };
}

function requirePort(value: number, label: string, min: number): number {
  if (!Number.isInteger(value) || value < min || value > 65535) {
    throw new ProductError('INTERNAL', {
      message: `${label}无效`,
      next: '填写 1–65535 的整数端口',
      detail: String(value),
    });
  }
  return value;
}

function requireHost(value: string, label: string): string {
  const host = value.trim();
  if (!host || host.length > 255) {
    throw new ProductError('INTERNAL', { message: `${label}无效`, next: '填写正确的地址后重试' });
  }
  return host;
}

function listen(server: net.Server, host: string, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(
        error.code === 'EADDRINUSE'
          ? new ProductError('INTERNAL', {
              message: '本地端口已被占用',
              next: '换一个端口，或先停掉占用该端口的进程',
              detail: `${host}:${port}`,
            })
          : new ProductError('INTERNAL', {
              message: '本地转发启动失败',
              next: '检查监听地址与端口后重试',
              detail: error.message,
            }),
      );
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      server.on('error', () => {});
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function forwardIn(client: ForwardClientLike, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.forwardIn(host, port, (error) => {
      if (error) {
        reject(
          new ProductError('INTERNAL', {
            message: '远程转发启动失败',
            next: '确认服务器允许端口转发，或换一个远端端口',
            detail: `${host}:${port}: ${error.message}`,
          }),
        );
        return;
      }
      resolve();
    });
  });
}

function unforwardIn(client: ForwardClientLike, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    client.unforwardIn(host, port, () => resolve());
  });
}
