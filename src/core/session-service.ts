import { ProductError, normalizeError } from './errors.ts';
import type { SessionHandle } from './manifest.ts';
import type { Capability, ExitInfo, SessionOpenOptions } from './ports.ts';
import type { ModuleRegistry } from './registry.ts';

export interface SessionEvents {
  onData(sessionId: string, data: string): void;
  onExit(sessionId: string, info: ExitInfo): void;
}

export interface OpenSessionResult {
  sessionId: string;
  capabilities: Capability[];
}

interface ActiveSession {
  handle: SessionHandle;
  detach: Array<() => void>;
}

/**
 * 能力路由 + 会话生命周期。对界面只暴露 sessionId 与 capabilities，
 * 协议差异全部留在能力模块里。
 */
export class SessionService {
  #registry: ModuleRegistry;
  #events: SessionEvents;
  #sessions = new Map<string, ActiveSession>();
  #counter = 0;

  constructor(registry: ModuleRegistry, events: SessionEvents) {
    this.#registry = registry;
    this.#events = events;
  }

  async open(options: SessionOpenOptions): Promise<OpenSessionResult> {
    const module = this.#registry.moduleForProtocol(options.protocol);
    const openSession = module.exports.openSession;
    if (!openSession) {
      throw new ProductError('UNSUPPORTED', {
        detail: `模块 ${module.manifest.id} 没有导出 openSession`,
      });
    }

    let handle: SessionHandle;
    try {
      handle = await openSession.call(module.exports, options);
    } catch (error) {
      throw normalizeError(error);
    }

    const sessionId = `${options.protocol}-${++this.#counter}`;
    const capabilities = capabilitiesOf(handle);
    const detach = [
      handle.session.onData((data) => this.#events.onData(sessionId, data)),
      handle.session.onExit((info) => {
        this.#teardown(sessionId);
        this.#events.onExit(sessionId, info);
      }),
    ];

    this.#sessions.set(sessionId, { handle, detach });
    return { sessionId, capabilities };
  }

  write(sessionId: string, data: string): void {
    const active = this.#sessions.get(sessionId);
    if (!active) return this.#warnLateCall(sessionId, 'write');
    active.handle.session.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const active = this.#sessions.get(sessionId);
    if (!active) return this.#warnLateCall(sessionId, 'resize');
    active.handle.session.resize(cols, rows);
  }

  close(sessionId: string): void {
    const active = this.#sessions.get(sessionId);
    if (!active) return;
    try {
      active.handle.session.close();
    } finally {
      this.#teardown(sessionId);
    }
  }

  dispose(): void {
    for (const sessionId of [...this.#sessions.keys()]) {
      this.close(sessionId);
    }
  }

  #teardown(sessionId: string): void {
    const active = this.#sessions.get(sessionId);
    if (!active) return;
    this.#sessions.delete(sessionId);
    for (const detach of active.detach) detach();
  }

  // 关闭与输入天然存在竞态：窗口关掉的瞬间仍可能收到按键，不能抛错打断用户。
  #warnLateCall(sessionId: string, action: string): void {
    console.debug(`[session] ${sessionId} 已关闭，忽略 ${action}`);
  }
}

function capabilitiesOf(handle: SessionHandle): Capability[] {
  const capabilities: Capability[] = ['session'];
  if (handle.exec) capabilities.push('exec');
  if (handle.file) capabilities.push('file');
  if (handle.transfer) capabilities.push('transfer');
  return capabilities;
}
