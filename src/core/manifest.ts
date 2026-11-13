import type { ModuleContext } from './context.ts';
import type {
  Capability,
  ExecPort,
  FilePort,
  ForwardPort,
  SessionOpenOptions,
  SessionPort,
  TransferPort,
} from './ports.ts';

export const API_VERSION = '1.0.0';

export type ModuleKind = 'capability' | 'panel' | 'theme' | 'command';

export interface ModuleManifest {
  id: string;
  kind: ModuleKind;
  builtin?: boolean;
  apiVersion: string;
  provides: Capability[];
  consumes?: string[];
  activation?: { onProtocol?: string };
}

/** 一个会话实际挂上的端口；capabilities 由这里推导，不用 manifest 声明。 */
export interface SessionHandle {
  session: SessionPort;
  exec?: ExecPort;
  file?: FilePort;
  transfer?: TransferPort;
  forward?: ForwardPort;
}

export interface ModuleExports {
  services?: Record<string, unknown>;
  openSession?(options: SessionOpenOptions): SessionHandle | Promise<SessionHandle>;
}

export interface ModuleSetup {
  exports?: ModuleExports;
  dispose(): void;
}

export interface CapabilityModule extends ModuleManifest {
  kind: 'capability';
  setup(ctx: ModuleContext): ModuleSetup;
}

/** apiVersion 是 ^x.y.z 形式：只校验主版本，补丁与次版本由调用方自己保证兼容。 */
export function isCompatibleApiVersion(required: string): boolean {
  const match = /^\^(\d+)\./.exec(required);
  if (!match) return false;
  return match[1] === API_VERSION.split('.')[0];
}
