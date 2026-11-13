import type { EventBus } from './event-bus.ts';

export interface ModuleLogger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export interface ModuleContext {
  readonly moduleId: string;
  get<T = unknown>(service: string): T;
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown) => void): () => void;
  readonly config: Readonly<Record<string, unknown>>;
  readonly log: ModuleLogger;
}

export interface ContextOptions {
  moduleId: string;
  bus: EventBus;
  getService: <T>(name: string) => T;
  config?: Record<string, unknown>;
}

export function createContext(options: ContextOptions): ModuleContext {
  const write = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void => {
    const line = `[${options.moduleId}] ${message}`;
    if (detail === undefined) console[level](line);
    else console[level](line, detail);
  };

  return {
    moduleId: options.moduleId,
    get: options.getService,
    emit: (event, payload) => options.bus.emit(event, payload),
    on: (event, handler) => options.bus.on(event, handler),
    config: Object.freeze({ ...(options.config ?? {}) }),
    log: {
      info: (message, detail) => write('info', message, detail),
      warn: (message, detail) => write('warn', message, detail),
      error: (message, detail) => write('error', message, detail),
    },
  };
}
