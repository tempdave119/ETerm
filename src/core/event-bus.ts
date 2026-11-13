type Handler = (payload: unknown) => void;

/** 模块之间只通过事件解耦；订阅返回退订函数，避免模块卸载后还挂在总线上。 */
export class EventBus {
  #handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    const handlers = this.#handlers.get(event) ?? new Set<Handler>();
    handlers.add(handler);
    this.#handlers.set(event, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#handlers.delete(event);
    };
  }

  emit(event: string, payload?: unknown): void {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;
    // 复制一份再遍历，允许处理器在回调里退订自己。
    for (const handler of [...handlers]) handler(payload);
  }

  clear(): void {
    this.#handlers.clear();
  }
}
