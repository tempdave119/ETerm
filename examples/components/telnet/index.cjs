'use strict';

const net = require('node:net');
const { StringDecoder } = require('node:string_decoder');
const { createTelnetProtocol, encodeUserData } = require('./protocol.cjs');

const CONNECT_TIMEOUT_MS = 10_000;

function failure(code, message, next, detail) {
  return { code, message, next, ...(detail === undefined ? {} : { detail }) };
}

module.exports = {
  id: 'telnet',
  kind: 'capability',
  builtin: false,
  apiVersion: '^1.0.0',
  provides: ['session'],
  activation: { onProtocol: 'telnet' },

  setup(ctx) {
    return {
      exports: {
        async openSession(options) {
          const target = options.target && typeof options.target === 'object' ? options.target : {};
          const host = typeof target.host === 'string' ? target.host.trim() : '';
          const port = Number(target.port ?? 23);
          if (!host) throw failure('INTERNAL', 'Telnet 连接缺少主机', '编辑连接，补全主机地址');
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw failure('INTERNAL', 'Telnet 端口无效', '编辑连接，填 1–65535 的端口');
          }

          const socket = net.connect({ host, port });
          socket.setNoDelay(true);
          await new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              socket.destroy();
              reject(failure('TIMEOUT', 'Telnet 连接超时', '确认主机与端口后重试', `${host}:${port}`));
            }, CONNECT_TIMEOUT_MS);

            socket.once('connect', () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve();
            });
            socket.once('error', (error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(error);
            });
          });

          socket.on('error', (error) => {
            ctx.log.warn('Telnet 连接异常', error instanceof Error ? error.message : error);
          });

          let size = { cols: options.cols ?? 80, rows: options.rows ?? 24 };
          const decoder = new StringDecoder('utf8');
          const dataHandlers = new Set();
          const exitHandlers = new Set();
          let pendingData = '';
          let exited = false;
          let plannedClose = false;
          let exitInfo = null;

          const emitData = (text) => {
            if (!text) return;
            if (dataHandlers.size === 0) {
              pendingData += text;
              return;
            }
            for (const handler of dataHandlers) handler(text);
          };

          const protocol = createTelnetProtocol({
            getSize: () => size,
            onData: (buffer) => emitData(decoder.write(buffer)),
            onReply: (buffer) => {
              if (!exited) socket.write(buffer);
            },
          });

          socket.on('data', (chunk) => protocol.push(chunk));
          socket.on('close', () => {
            if (exited) return;
            exited = true;
            const tail = decoder.end();
            if (tail) emitData(tail);
            // 用户关标签是 closed；服务端或链路主动断开交给自动重连判断。
            exitInfo = { code: plannedClose ? 0 : null, reason: plannedClose ? 'closed' : 'network' };
            for (const handler of exitHandlers) handler(exitInfo);
          });

          socket.write(protocol.initial());
          ctx.log.info(`Telnet 会话已建立 ${host}:${port}`);

          const session = {
            write(data) {
              if (exited) return;
              const buffer = encodeUserData(data);
              if (buffer.length > 0) socket.write(buffer);
            },
            resize(cols, rows) {
              size = { cols: Math.max(2, cols), rows: Math.max(1, rows) };
              const frame = protocol.resize(size.cols, size.rows);
              if (frame && !exited) socket.write(frame);
            },
            close() {
              if (exited) return;
              plannedClose = true;
              socket.end();
            },
            onData(handler) {
              dataHandlers.add(handler);
              if (pendingData) {
                const buffered = pendingData;
                pendingData = '';
                handler(buffered);
              }
              return () => dataHandlers.delete(handler);
            },
            onExit(handler) {
              exitHandlers.add(handler);
              if (exitInfo) handler(exitInfo);
              return () => exitHandlers.delete(handler);
            },
          };

          return { session };
        },
      },
      dispose() {
        // 会话由 SessionService 统一释放；组件本身不持有连接。
      },
    };
  },
};
