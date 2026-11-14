import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuPercentBetween, readSystemStats } from '../../src/services/system/stats.ts';

test('system_cpu_percent_returns_zero_without_baseline', () => {
  assert.equal(cpuPercentBetween(null, { idle: 100, total: 200 }), 0);
});

test('system_cpu_percent_uses_delta_between_samples', () => {
  assert.equal(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 120, total: 400 }), 90);
  assert.equal(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 150, total: 300 }), 50);
});

test('system_cpu_percent_handles_stalled_counters', () => {
  assert.equal(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 100, total: 200 }), 0);
  assert.equal(cpuPercentBetween({ idle: 300, total: 400 }, { idle: 100, total: 400 }), 0);
});

test('system_stats_reads_memory_and_load_from_host', async () => {
  const { stats } = await readSystemStats(null);

  assert.ok(stats.memTotal > 0);
  assert.ok(stats.memUsed >= 0 && stats.memUsed <= stats.memTotal);
  assert.equal(stats.load.length, 3);
  assert.ok(stats.cpus > 0);
  assert.ok(stats.uptime > 0);
  assert.ok(stats.hostname && stats.hostname.length > 0);
  assert.ok((stats.filesystems?.length ?? 0) >= 1);
  assert.equal(stats.filesystems?.[0]?.path, '/');
  assert.ok((stats.processes?.length ?? 0) >= 1);
  assert.ok((stats.processes?.length ?? 0) <= 5);
  assert.ok((stats.processesByCpu?.length ?? 0) <= 5);
  assert.equal(stats.cpuPercent, 0);
});
