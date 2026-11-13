import type { Client, SFTPWrapper } from 'ssh2';
import type { CapabilityModule, SessionHandle } from '../../core/manifest.ts';
import { connectSsh } from './connection.ts';
import { createExecPort } from './exec.ts';
import { openSessionPort } from './session.ts';
import { createFilePort, type SftpLike } from './sftp.ts';
import { createTransferPort, type SftpTransferLike } from './transfer.ts';
import { parseSshTarget } from './target.ts';

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

export const sshModule: CapabilityModule = {
  id: 'core-ssh',
  kind: 'capability',
  builtin: true,
  apiVersion: '^1.0.0',
  provides: ['session', 'exec', 'file', 'transfer'],
  activation: { onProtocol: 'ssh' },
  setup(ctx) {
    return {
      exports: {
        async openSession(options) {
          const target = parseSshTarget(options.target);
          const { client } = await connectSsh(target);
          client.on('error', (error) => ctx.log.warn('SSH 连接异常', error));

          let sftp: SFTPWrapper | null = null;
          try {
            sftp = await openSftp(client);
          } catch (error) {
            // 服务器可能关掉 SFTP 子系统；终端与 exec 仍可用，能力集合如实反映。
            ctx.log.warn('SFTP 不可用，会话降级为终端与执行', error instanceof Error ? error.message : error);
          }

          let session;
          try {
            session = await openSessionPort(client, options.cols, options.rows);
          } catch (error) {
            client.end();
            throw error;
          }

          const handle: SessionHandle = {
            session,
            exec: createExecPort(client),
          };
          if (sftp) {
            // ssh2 的重载签名比最小接口宽，边界处收敛一次。
            handle.file = createFilePort(sftp as unknown as SftpLike);
            handle.transfer = createTransferPort(sftp as unknown as SftpTransferLike);
          }

          ctx.log.info(`SSH 会话已建立 ${target.username}@${target.host}:${target.port}`);
          return handle;
        },
      },
      dispose() {
        // 会话由 SessionService 统一释放；模块本身不持有连接。
      },
    };
  },
};
