/**
 * 示例插件安装：应用资源里带 S3 浏览器样例，设置页可一键复制到 userData/plugins。
 * 只做「缺什么补什么」，不覆盖用户已经改过的插件目录。
 */

import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePluginManifest, type PluginSample } from '../../shared/plugins.ts';

export interface PluginSampleDirs {
  /** 应用资源里的示例插件目录；开发模式指向仓库 examples/plugins。 */
  bundledDir: string;
  /** userData 下的 plugins 目录。 */
  userDir: string;
}

interface SampleMeta {
  entry: string;
  sample: PluginSample;
}

async function readBundledSamples(dirs: PluginSampleDirs): Promise<SampleMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(dirs.bundledDir);
  } catch {
    return [];
  }

  const samples: SampleMeta[] = [];
  for (const entry of entries.sort()) {
    try {
      const manifest = parsePluginManifest(
        JSON.parse(await readFile(join(dirs.bundledDir, entry, 'manifest.json'), 'utf8')) as unknown,
      );
      samples.push({
        entry,
        sample: {
          id: manifest.id,
          version: manifest.version,
          description: manifest.description,
          installed: await exists(join(dirs.userDir, manifest.id, 'manifest.json')),
        },
      });
    } catch {
      // 坏样例不阻塞列表；安装时会给出具体原因。
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

export async function listPluginSamples(dirs: PluginSampleDirs): Promise<PluginSample[]> {
  return (await readBundledSamples(dirs)).map((item) => item.sample);
}

/**
 * 安装示例：不传 ids 时装全部缺失项，传 ids 时只装指定项。
 * 目标目录已存在时跳过，避免覆盖用户修改。
 */
export async function installPluginSamples(
  dirs: PluginSampleDirs,
  ids?: readonly string[],
): Promise<{ installed: string[]; skipped: string[] }> {
  await mkdir(dirs.userDir, { recursive: true });
  const wanted = ids ? new Set(ids) : null;
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const item of await readBundledSamples(dirs)) {
    if (wanted && !wanted.has(item.sample.id)) continue;
    const target = join(dirs.userDir, item.entry);
    if (await exists(join(target, 'manifest.json'))) {
      skipped.push(item.sample.id);
      continue;
    }
    await cp(join(dirs.bundledDir, item.entry), target, { recursive: true, force: false, errorOnExist: true });
    installed.push(item.sample.id);
  }

  // 请求了不存在的 id 也记 skipped，调用方才能判断这次有没有落空。
  if (wanted) {
    for (const id of wanted) {
      if (!installed.includes(id) && !skipped.includes(id)) skipped.push(id);
    }
  }

  return { installed, skipped };
}
