import { statfsSync } from 'node:fs';
import os from 'node:os';
import type { FileSystemUsage, SystemStats } from '../../shared/ipc.ts';

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

export function readSystemStats(previous: CpuSnapshot | null): {
  stats: SystemStats;
  snapshot: CpuSnapshot;
} {
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
  return {
    stats: {
      cpuPercent: cpuPercentBetween(previous, snapshot),
      memUsed: memTotal - os.freemem(),
      memTotal,
      load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
      uptime: os.uptime(),
      cpus: os.cpus().length,
      filesystems,
    },
    snapshot,
  };
}
