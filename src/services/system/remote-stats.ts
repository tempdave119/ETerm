import type { FileSystemUsage, SystemStats } from '../../shared/ipc.ts';

/**
 * 远端资源采样脚本：只依赖 POSIX shell + ps + awk，Linux / macOS 通用。
 * 输出 key=value 行，解析在宿主完成；命令固定，不接受任何用户输入。
 */
export const REMOTE_STATS_COMMAND = [
  'cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)',
  'if [ -r /proc/loadavg ]; then load=$(awk \'{print $1" "$2" "$3}\' /proc/loadavg); else load=$(sysctl -n vm.loadavg 2>/dev/null | tr -d "{}"); fi',
  'cpu=$(ps -A -o %cpu 2>/dev/null | awk \'NR>1 {s+=$1} END {print s+0}\')',
  'if [ -r /proc/uptime ]; then uptime=$(awk \'{print int($1)}\' /proc/uptime); else boot=$(sysctl -n kern.boottime 2>/dev/null | awk -F\'[=,]\' \'{print $2}\' | tr -d " "); now=$(date +%s); if [ -n "$boot" ]; then uptime=$((now-boot)); else uptime=0; fi; fi',
  'if [ -r /proc/meminfo ]; then',
  '  total=$(awk \'/^MemTotal:/ {print $2*1024}\' /proc/meminfo)',
  '  avail=$(awk \'/^MemAvailable:/ {print $2*1024}\' /proc/meminfo)',
  '  if [ -z "$avail" ]; then avail=$(awk \'/^MemFree:|^Buffers:|^Cached:/ {s+=$2} END {print s*1024}\' /proc/meminfo); fi',
  'else',
  '  pagesize=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)',
  '  total=$(sysctl -n hw.memsize 2>/dev/null || echo 0)',
  '  avail=$(vm_stat 2>/dev/null | awk -v p="$pagesize" \'/Pages free|Pages inactive|Pages speculative/ {gsub(/\\./,"",$NF); s+=$NF} END {print s*p}\')',
  'fi',
  'echo "cpus=$cpus"',
  'echo "load=$load"',
  'echo "cpu=$cpu"',
  'echo "total=$total"',
  'echo "avail=$avail"',
  'echo "uptime=$uptime"',
  'df -kP 2>/dev/null | awk \'NR>1 && $1 !~ /^(devfs|devtmpfs|tmpfs|overlay|shm|udev|none)$/ && $6 != "" {print "fs=" $6 "|" $3 "|" $2}\' | head -n 6',
].join('\n');

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseRemoteStats(stdout: string): SystemStats {
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }

  const cpus = Math.max(1, Math.round(toNumber(values.get('cpus'))));
  const memTotal = Math.round(toNumber(values.get('total')));
  if (memTotal <= 0) throw new Error('远端资源数据不完整：内存总量为 0');
  const memAvailable = Math.max(0, Math.round(toNumber(values.get('avail'))));
  const cpuSum = Math.max(0, toNumber(values.get('cpu')));
  const loadParts = (values.get('load') ?? '').match(/-?\d+(?:\.\d+)?/g) ?? [];
  const filesystems: FileSystemUsage[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('fs=')) continue;
    const [path, usedKb, totalKb] = line.slice(3).split('|');
    const total = toNumber(totalKb) * 1024;
    if (!path || total <= 0) continue;
    filesystems.push({ path, used: Math.min(total, toNumber(usedKb) * 1024), total });
    if (filesystems.length >= 6) break;
  }

  return {
    cpuPercent: Math.min(100, Math.max(0, Math.round(cpuSum / cpus))),
    memUsed: Math.max(0, memTotal - memAvailable),
    memTotal,
    load: [toNumber(loadParts[0]), toNumber(loadParts[1]), toNumber(loadParts[2])],
    uptime: toNumber(values.get('uptime')),
    cpus,
    filesystems,
  };
}
