import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { CapabilityModule } from '../core/manifest.ts';
import type { ModuleRegistry } from '../core/registry.ts';
import type { ComponentDescriptor, ComponentField } from '../shared/components.ts';

interface ComponentManifest {
  id: string;
  kind: 'capability';
  apiVersion: string;
  entry: string;
  activation: { onProtocol: string };
  ui?: { label?: string; fields?: unknown };
}

export interface LoadComponentsOptions {
  baseDir: string;
  registry: ModuleRegistry;
  logger?: (message: string, detail?: unknown) => void;
}

/**
 * 从 <userData>/components/<id>/manifest.json 装载可选组件。
 * 只支持 CJS 入口（v1）；单个组件坏了跳过并记日志，不能让宿主启动失败。
 */
export async function loadComponents(options: LoadComponentsOptions): Promise<ComponentDescriptor[]> {
  const log = options.logger ?? ((message, detail) => console.warn(`[components] ${message}`, detail ?? ''));
  const root = join(options.baseDir, 'components');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const descriptors: ComponentDescriptor[] = [];
  for (const entry of entries.sort()) {
    try {
      const descriptor = await loadOne(root, entry, options, log);
      if (descriptor) descriptors.push(descriptor);
    } catch (error) {
      log(`组件 ${entry} 装载失败，已跳过`, error instanceof Error ? error.message : error);
    }
  }
  return descriptors;
}

async function loadOne(
  root: string,
  entry: string,
  options: LoadComponentsOptions,
  log: (message: string, detail?: unknown) => void,
): Promise<ComponentDescriptor | null> {
  const dir = join(root, entry);
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as unknown;
  const manifest = parseManifest(raw);

  const entryPath = resolve(dir, manifest.entry);
  if (entryPath !== dir && !entryPath.startsWith(dir + sep)) {
    throw new Error('entry 必须位于组件目录内');
  }

  const requireComponent = createRequire(join(root, 'loader.cjs'));
  const loaded = requireComponent(entryPath) as { default?: CapabilityModule } | CapabilityModule;
  const module = ('default' in loaded && loaded.default ? loaded.default : loaded) as CapabilityModule;

  if (module.id !== manifest.id) throw new Error(`模块 id 与 manifest 不一致：${module.id}`);
  const protocol = module.activation?.onProtocol;
  if (!protocol || protocol !== manifest.activation.onProtocol) {
    throw new Error('activation.onProtocol 与 manifest 不一致');
  }

  options.registry.register(module);

  const fields = parseFields(manifest.ui?.fields);
  return {
    id: manifest.id,
    protocol,
    label: typeof manifest.ui?.label === 'string' && manifest.ui.label.trim() ? manifest.ui.label.trim() : manifest.id,
    fields,
  };
}

function parseManifest(raw: unknown): ComponentManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('manifest 必须是对象');
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 64) throw new Error('manifest.id 无效');
  if (record.kind !== 'capability') throw new Error('manifest.kind 必须是 capability（panel / theme / command 为预留，未实现）');
  if (typeof record.apiVersion !== 'string' || !/^\^\d+\./.test(record.apiVersion)) {
    throw new Error('manifest.apiVersion 必须形如 ^1.0.0');
  }
  if (typeof record.entry !== 'string' || !record.entry.trim()) throw new Error('manifest.entry 无效');

  const activation = record.activation;
  if (typeof activation !== 'object' || activation === null || Array.isArray(activation)) {
    throw new Error('manifest.activation 缺失');
  }
  const protocol = (activation as Record<string, unknown>).onProtocol;
  if (typeof protocol !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(protocol)) {
    throw new Error('manifest.activation.onProtocol 必须是 1–32 位小写协议名');
  }

  return {
    id: record.id.trim(),
    kind: 'capability',
    apiVersion: record.apiVersion,
    entry: record.entry.trim(),
    activation: { onProtocol: protocol },
    ui: typeof record.ui === 'object' && record.ui !== null ? (record.ui as ComponentManifest['ui']) : undefined,
  };
}

function parseFields(raw: unknown): ComponentField[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 10) throw new Error('组件字段最多 10 个');

  const seen = new Set<string>();
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('字段定义必须是对象');
    const record = item as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!key || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(key)) throw new Error(`字段 key 无效：${key}`);
    if (!label) throw new Error(`字段 ${key} 缺少 label`);
    if (seen.has(key)) throw new Error(`字段 key 重复：${key}`);
    seen.add(key);

    const type =
      record.type === 'select' || record.type === 'number' || record.type === 'boolean'
        ? record.type
        : 'text';
    const options = Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string').slice(0, 20)
      : undefined;

    return {
      key,
      label,
      type,
      ...(typeof record.placeholder === 'string' ? { placeholder: record.placeholder } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      // 动态选项只认宿主支持的来源，未知值忽略（当普通 select 处理）。
      ...(record.optionsSource === 'serial-devices' ? { optionsSource: 'serial-devices' as const } : {}),
      ...(typeof record.default === 'string' ? { default: record.default } : {}),
      ...(record.required === true ? { required: true } : {}),
    };
  });
}
