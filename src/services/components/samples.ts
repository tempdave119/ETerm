/**
 * 示例组件安装：应用资源里带 serial / telnet 样例，设置页可一键复制到 userData。
 * 只做「缺什么补什么」，不覆盖用户已经改过的组件目录。
 */

import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentSample } from '../../shared/components.ts';

export interface ComponentSampleDirs {
  /** 应用资源里的示例组件目录；开发模式指向仓库 examples/components。 */
  bundledDir: string;
  /** userData 下的 components 目录。 */
  userDir: string;
}

interface SampleMeta {
  entry: string;
  sample: ComponentSample;
}

interface BundledManifest {
  id?: unknown;
  kind?: unknown;
  activation?: { onProtocol?: unknown };
  ui?: { label?: unknown };
}

async function readBundledSamples(dirs: ComponentSampleDirs): Promise<SampleMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(dirs.bundledDir);
  } catch {
    return [];
  }

  const samples: SampleMeta[] = [];
  for (const entry of entries.sort()) {
    try {
      const raw = JSON.parse(
        await readFile(join(dirs.bundledDir, entry, 'manifest.json'), 'utf8'),
      ) as BundledManifest;
      if (raw.kind !== 'capability') continue;
      const protocol = raw.activation?.onProtocol;
      if (typeof protocol !== 'string' || !protocol) continue;
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : entry;
      const label =
        typeof raw.ui?.label === 'string' && raw.ui.label.trim() ? raw.ui.label.trim() : id;
      samples.push({
        entry,
        sample: {
          id,
          label,
          protocol,
          installed: await exists(join(dirs.userDir, entry, 'manifest.json')),
        },
      });
    } catch {
      // 坏样例不阻塞列表；启动装载器会记录具体原因。
    }
  }
  return samples;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function listComponentSamples(dirs: ComponentSampleDirs): Promise<ComponentSample[]> {
  return (await readBundledSamples(dirs)).map((item) => item.sample);
}

/** 卸载只允许随包示例 id；已不存在的目录记为 skipped。 */
export async function uninstallComponentSamples(
  dirs: ComponentSampleDirs,
  ids: readonly string[],
): Promise<{ removed: string[]; skipped: string[] }> {
  const allowed = new Map((await readBundledSamples(dirs)).map((item) => [item.sample.id, item.entry]));
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const id of ids) {
    const entry = allowed.get(id);
    if (!entry) {
      skipped.push(id);
      continue;
    }
    const target = join(dirs.userDir, entry);
    if (!(await exists(join(target, 'manifest.json')))) {
      skipped.push(id);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    removed.push(id);
  }

  return { removed, skipped };
}

/** 返回 installed / skipped；目标目录已存在时跳过，避免覆盖用户修改。 */
export async function installComponentSamples(
  dirs: ComponentSampleDirs,
): Promise<{ installed: string[]; skipped: string[] }> {
  await mkdir(dirs.userDir, { recursive: true });
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const item of await readBundledSamples(dirs)) {
    const target = join(dirs.userDir, item.entry);
    if (await exists(join(target, 'manifest.json'))) {
      skipped.push(item.sample.id);
      continue;
    }
    await cp(join(dirs.bundledDir, item.entry), target, { recursive: true, force: false });
    installed.push(item.sample.id);
  }

  return { installed, skipped };
}
