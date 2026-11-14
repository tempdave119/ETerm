import type { Client } from 'ssh2';
import { ProductError, normalizeError } from '../../core/errors.ts';
import type { ExecPort, ExecResult } from '../../core/ports.ts';

const EXEC_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;

export function createExecPort(client: Client): ExecPort {
  return {
    exec(command: string): Promise<ExecResult> {
      return new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
          if (error) {
            reject(normalizeError(error));
            return;
          }

          let stdout = '';
          let stderr = '';
          let code: number | null = null;
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          // 远端命令挂住会拖死调用方（监控轮询），输出无上限则可能撑爆主进程，两者都必须封顶。
          const finish = (action: () => void): void => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            action();
          };
          const abort = (reason: ProductError): void => {
            finish(() => reject(reason));
            stream.close();
          };

          timer = setTimeout(() => {
            abort(
              new ProductError('TIMEOUT', {
                message: '远端命令执行超时',
                next: '检查远端负载与网络后重试',
                detail: command,
              }),
            );
          }, EXEC_TIMEOUT_MS);

          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
            if (stdout.length > MAX_OUTPUT_CHARS) {
              abort(new ProductError('INTERNAL', { message: '远端命令输出过大，已中止' }));
            }
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
          });
          stream.on('exit', (exitCode: number | null) => {
            code = typeof exitCode === 'number' ? exitCode : null;
          });
          stream.on('close', () => finish(() => resolve({ stdout, stderr, code })));
          stream.on('error', (streamError: Error) => abort(normalizeError(streamError)));
        });
      });
    },
  };
}
