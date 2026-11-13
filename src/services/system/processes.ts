import type { ProcessUsage } from '../../shared/ipc.ts';

const MAX_PROCESSES = 5;

/**
 * 解析 `ps -A -o pid=,rss=,%cpu=,%mem=,comm=` 的输出。
 * 字段顺序固定为 pid / rss / %cpu / %mem，剩下全部是命令名；
 * 这样命令名带空格时也不会被截断。
 */
export function parseProcessList(stdout: string, limit = MAX_PROCESSES): ProcessUsage[] {
  const processes: ProcessUsage[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/^proc=/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const pid = Number(parts[0]);
    const rssKb = Number(parts[1]);
    const cpuPercent = Number(parts[2]);
    const memPercent = Number(parts[3]);
    const rawName = parts.slice(4).join(' ');
    const name = rawName.split('/').filter(Boolean).at(-1) ?? rawName;
    if (!Number.isFinite(pid) || !name || !Number.isFinite(rssKb)) continue;
    processes.push({
      pid,
      name,
      rss: Math.max(0, Math.round(rssKb * 1024)),
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : 0,
      memPercent: Number.isFinite(memPercent) ? Math.max(0, memPercent) : 0,
    });
  }

  processes.sort((left, right) => right.rss - left.rss);
  return processes.slice(0, limit);
}
