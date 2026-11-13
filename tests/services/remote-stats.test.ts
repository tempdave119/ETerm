import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteStats } from '../../src/services/system/remote-stats.ts';

test('remote_stats_parses_linux_output', () => {
  const stats = parseRemoteStats(
    [
      'cpus=4',
      'load=0.52 0.58 0.59',
      'cpu=37',
      'total=8589934592',
      'avail=4294967296',
      'uptime=7200',
      'fs=/|524288|1048576',
    ].join('\n'),
  );

  assert.equal(stats.cpus, 4);
  assert.equal(stats.cpuPercent, 9);
  assert.equal(stats.memTotal, 8589934592);
  assert.equal(stats.memUsed, 4294967296);
  assert.equal(stats.uptime, 7200);
  assert.deepEqual(stats.filesystems, [{ path: '/', used: 536870912, total: 1073741824 }]);
  assert.deepEqual(stats.load, [0.52, 0.58, 0.59]);
});

test('remote_stats_parses_macos_output_and_clamps_cpu', () => {
  const stats = parseRemoteStats(
    ['cpus=8', 'load= 1.23 1.45 1.67', 'cpu=200', 'total=17179869184', 'avail=8589934592', 'uptime=90061'].join(
      '\n',
    ),
  );

  assert.equal(stats.cpus, 8);
  assert.equal(stats.cpuPercent, 25);
  assert.equal(stats.memUsed, 8589934592);
  assert.equal(stats.uptime, 90061);
  assert.deepEqual(stats.load, [1.23, 1.45, 1.67]);
});

test('remote_stats_rejects_incomplete_memory', () => {
  assert.throws(() => parseRemoteStats('cpus=2\nload=0 0 0\ncpu=10\ntotal=0\navail=0'), /内存总量/);
});
