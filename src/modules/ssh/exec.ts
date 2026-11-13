import type { Client } from 'ssh2';
import { normalizeError } from '../../core/errors.ts';
import type { ExecPort, ExecResult } from '../../core/ports.ts';

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

          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
          });
          stream.on('exit', (exitCode: number | null) => {
            code = typeof exitCode === 'number' ? exitCode : null;
          });
          stream.on('close', () => resolve({ stdout, stderr, code }));
          stream.on('error', (streamError: Error) => reject(normalizeError(streamError)));
        });
      });
    },
  };
}
