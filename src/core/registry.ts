import { createContext } from './context.ts';
import { EventBus } from './event-bus.ts';
import { ProductError } from './errors.ts';
import { isCompatibleApiVersion, type CapabilityModule, type ModuleExports, type ModuleManifest } from './manifest.ts';

export interface RegisteredModule {
  readonly manifest: ModuleManifest;
  readonly exports: ModuleExports;
}

interface ModuleSlot {
  manifest: CapabilityModule;
  exports: ModuleExports;
  dispose?: () => void;
}

/**
 * 模块注册表只做三件事：校验 manifest、按顺序 setup、按协议路由。
 * 它不认识 Electron，也不认识任何具体能力实现。
 */
export class ModuleRegistry {
  #modules = new Map<string, ModuleSlot>();
  #protocols = new Map<string, string>();
  #services = new Map<string, unknown>();
  /** 宿主注入的服务名；这些服务只归宿主，模块不能通过 ctx 取用。 */
  #hostServices = new Set<string>();
  #setup = new Set<string>();
  #bus = new EventBus();
  #disposed = false;

  register(module: CapabilityModule): void {
    this.#assertManifest(module);
    if (this.#modules.has(module.id)) {
      throw new Error(`模块 id 重复：${module.id}`);
    }

    const protocol = module.activation?.onProtocol;
    if (protocol) {
      const owner = this.#protocols.get(protocol);
      if (owner) throw new Error(`协议 ${protocol} 已被模块 ${owner} 声明`);
      this.#protocols.set(protocol, module.id);
    }

    this.#modules.set(module.id, { manifest: module, exports: {} });
  }

  setupAll(): void {
    for (const slot of this.#modules.values()) {
      // 可选组件可能在内置模块 setup 之后才装载，这里按模块幂等，重复调用只补新模块。
      if (this.#setup.has(slot.manifest.id)) continue;

      const ctx = createContext({
        moduleId: slot.manifest.id,
        bus: this.#bus,
        // 模块只能取自己 consumes 里声明过的服务；宿主服务（凭据 / 连接 / 指纹 / 布局）
        // 只归宿主，避免组件通过 ctx 读到凭据库。
        getService: <T,>(name: string): T => {
          const declared = slot.manifest.consumes ?? [];
          if (!declared.includes(name)) throw new Error(`模块 ${slot.manifest.id} 未声明服务 ${name}`);
          if (this.#hostServices.has(name)) throw new Error(`宿主服务 ${name} 不对模块开放`);
          return this.getService<T>(name);
        },
      });

      const setup = slot.manifest.setup(ctx);
      if (typeof setup?.dispose !== 'function') {
        throw new Error(`模块 ${slot.manifest.id} 的 setup() 必须返回 dispose()`);
      }

      slot.exports = setup.exports ?? {};
      slot.dispose = setup.dispose;
      this.#setup.add(slot.manifest.id);

      for (const [name, service] of Object.entries(slot.exports.services ?? {})) {
        if (this.#services.has(name)) throw new Error(`服务名重复：${name}`);
        this.#services.set(name, service);
      }
    }
  }

  getService<T>(name: string): T {
    if (!this.#services.has(name)) throw new Error(`服务未提供：${name}`);
    return this.#services.get(name) as T;
  }

  /** 宿主层提供的应用服务（存储 / 凭据等），先于模块 setup 注入。 */
  provide(name: string, service: unknown): void {
    if (this.#services.has(name)) throw new Error(`服务名重复：${name}`);
    this.#services.set(name, service);
    this.#hostServices.add(name);
  }

  moduleForProtocol(protocol: string): RegisteredModule {
    const id = this.#protocols.get(protocol);
    const slot = id ? this.#modules.get(id) : undefined;
    if (!slot) {
      throw new ProductError('UNSUPPORTED', { message: `当前版本不支持 ${protocol} 连接` });
    }
    return { manifest: slot.manifest, exports: slot.exports };
  }

  list(): ModuleManifest[] {
    return [...this.#modules.values()].map((slot) => slot.manifest);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    // 与 setup 顺序相反，后初始化的先释放。
    for (const slot of [...this.#modules.values()].reverse()) {
      slot.dispose?.();
    }
    this.#services.clear();
    this.#hostServices.clear();
    this.#bus.clear();
  }

  #assertManifest(module: CapabilityModule): void {
    if (module.kind !== 'capability') {
      throw new Error(`模块 ${module.id} 的 kind 必须是 capability（panel / theme / command 为预留，未实现）`);
    }
    if (!module.id.trim()) throw new Error('模块 id 不能为空');
    if (!isCompatibleApiVersion(module.apiVersion)) {
      throw new Error(`模块 ${module.id} 的 apiVersion 与宿主不兼容：${module.apiVersion}`);
    }
    if (module.provides.length === 0) throw new Error(`模块 ${module.id} 必须声明 provides`);
    if (module.provides.includes('session') && !module.activation?.onProtocol) {
      throw new Error(`模块 ${module.id} 提供会话能力，必须声明 activation.onProtocol`);
    }
  }
}
