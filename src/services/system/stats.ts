import { execFile } from 'node:child_process';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import type { FileSystemUsage, ProcessUsage, SystemStats } from '../../shared/ipc.ts';
import { parseProcessList } from './processes.ts';

const run = promisify(execFile);

export interface CpuSnapshot {
  idle: number;
  total: number;
}

export function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    for (const value of Object.values(cpu.times)) total += value;
  }
  return { idle, total };
}

/** 两次采样之间的 CPU 占用：第一次没有基线时返回 0，避免把开机以来的平均值当瞬时值。 */
export function cpuPercentBetween(previous: CpuSnapshot | null, current: CpuSnapshot): number {
  if (!previous) return 0;
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)));
}

export async function readSystemStats(previous: CpuSnapshot | null): Promise<{
  stats: SystemStats;
  snapshot: CpuSnapshot;
}> {
  const snapshot = cpuSnapshot();
  const memTotal = os.totalmem();
  const load = os.loadavg();
  let filesystems: FileSystemUsage[] = [];
  try {
    const root = statfsSync('/');
    const total = root.bsize * root.blocks;
    const available = root.bsize * root.bavail;
    filesystems = [{ path: '/', used: Math.max(0, total - available), total }];
  } catch {
    filesystems = [];
  }
  let processes: ProcessUsage[] = [];
  let processesByCpu: ProcessUsage[] = [];
  try {
    // 必须异步：macOS 的 ps 本身要 60–100ms，同步执行会把主进程事件循环卡住，
    // 每秒一次的采样会拖慢终端数据与其它 IPC。
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,rss=,%cpu=,%mem=,comm='], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    processes = parseProcessList(stdout);
    processesByCpu = parseProcessList(stdout, { sortBy: 'cpu' });
  } catch {
    processes = [];
    processesByCpu = [];
  }
  return {
    stats: {
      cpuPercent: cpuPercentBetween(previous, snapshot),
      memUsed: memTotal - os.freemem(),
      memTotal,
      load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
      uptime: os.uptime(),
      cpus: os.cpus().length,
      filesystems,
      hostname: os.hostname(),
      processes,
      processesByCpu,
    },
    snapshot,
  };
}
