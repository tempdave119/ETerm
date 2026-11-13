import type { Client, ClientChannel } from 'ssh2';
import type { ExitInfo, SessionPort } from '../../core/ports.ts';

const TERM = 'xterm-256color';

export function openSessionPort(client: Client, cols: number, rows: number): Promise<SessionPort> {
  return new Promise((resolve, reject) => {
    client.shell({ term: TERM, cols, rows }, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      // 在 shell 回调里同步装好监听，避免首屏输出在 Promise 交回前就被丢掉。
      resolve(createSessionPort(client, stream));
    });
  });
}

/**
 * 会话端口包住 shell 通道。终端与 SFTP 共用同一条 SSH 连接：
 * 连接断开时这里统一发 exit，文件端口随之失效，不会出现「终端断了文件还在」。
 */
export function createSessionPort(client: Client, stream: ClientChannel): SessionPort {
  let exitCode: number | null = null;
  let finished = false;
  let pendingData = '';
  const dataHandlers = new Set<(data: string) => void>();
  const exitHandlers = new Set<(info: ExitInfo) => void>();

  const finish = (info: ExitInfo): void => {
    if (finished) return;
    finished = true;
    for (const handler of exitHandlers) handler(info);
    // 终端退出即断开整条连接：SFTP / exec 与它同生共死，避免留下半开连接。
    client.end();
  };

  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    if (dataHandlers.size === 0) {
      pendingData += text;
      return;
    }
    for (const handler of dataHandlers) handler(text);
  });
  stream.on('exit', (code: number | null) => {
    exitCode = typeof code === 'number' ? code : null;
  });
  stream.on('close', () => finish({ code: exitCode }));
  client.on('close', () => finish({ code: exitCode }));

  return {
    write: (data) => {
      if (!finished) stream.write(data);
    },
    resize: (cols, rows) => {
      if (!finished) stream.setWindow(Math.max(1, rows), Math.max(2, cols), 0, 0);
    },
    close: () => {
      if (!finished) stream.close();
      client.end();
    },
    onData: (handler) => {
      dataHandlers.add(handler);
      if (pendingData) {
        const buffered = pendingData;
        pendingData = '';
        handler(buffered);
      }
      return () => dataHandlers.delete(handler);
    },
    onExit: (handler) => {
      exitHandlers.add(handler);
      if (finished) handler({ code: exitCode });
      return () => exitHandlers.delete(handler);
    },
  };
}
