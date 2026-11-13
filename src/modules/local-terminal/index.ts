import type { CapabilityModule } from '../../core/manifest.ts';
import type { ExitInfo, SessionPort } from '../../core/ports.ts';

// 主进程以 CJS 打包，运行时 require 可用；延迟加载原生模块，纯逻辑测试不依赖 PTY。
function loadPty(): typeof import('node-pty') {
  return require('node-pty') as typeof import('node-pty');
}

const LOGIN_SHELL = process.env.SHELL ?? '/bin/zsh';

export const localTerminalModule: CapabilityModule = {
  id: 'core-local-terminal',
  kind: 'capability',
  builtin: true,
  apiVersion: '^1.0.0',
  provides: ['session'],
  activation: { onProtocol: 'local' },
  setup(ctx) {
    ctx.log.info(`本地终端模块就绪，shell=${LOGIN_SHELL}`);

    return {
      exports: {
        openSession(options) {
          const pty = loadPty();
          const proc = pty.spawn(LOGIN_SHELL, ['-l'], {
            name: 'xterm-256color',
            cols: options.cols,
            rows: options.rows,
            cwd: options.cwd ?? process.env.HOME,
            env: buildEnv(options.env),
          });

          // spawn 与监听之间存在窗口期：首屏 prompt 可能在 SessionService 动手订阅前就输出，
          // 先自行接住，等第一个订阅者挂上再补发。
          let pendingData = '';
          let exitInfo: ExitInfo | null = null;
          let exited = false;
          const dataHandlers = new Set<(data: string) => void>();
          const exitHandlers = new Set<(info: ExitInfo) => void>();

          proc.onData((data) => {
            if (dataHandlers.size === 0) {
              pendingData += data;
              return;
            }
            for (const handler of dataHandlers) handler(data);
          });
          proc.onExit(({ exitCode, signal }) => {
            exited = true;
            exitInfo = { code: exitCode, signal };
            for (const handler of exitHandlers) handler(exitInfo);
          });

          const session: SessionPort = {
            write: (data) => {
              if (!exited) proc.write(data);
            },
            // 终端有最小尺寸，收到 0 列会让 shell 输出错乱。
            resize: (cols, rows) => {
              if (!exited) proc.resize(Math.max(2, cols), Math.max(1, rows));
            },
            close: () => {
              if (!exited) proc.kill();
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
              if (exitInfo) handler(exitInfo);
              return () => exitHandlers.delete(handler);
            },
          };

          ctx.log.info(`本地终端已启动 pid=${proc.pid}`);
          return { session };
        },
      },
      dispose() {
        // 会话由 SessionService 统一释放；模块本身不持有资源。
      },
    };
  },
};

function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return { ...env, ...extra };
}
