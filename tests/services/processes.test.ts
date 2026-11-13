import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcessList } from '../../src/services/system/processes.ts';

test('processes_parse_sorts_by_rss_and_keeps_spaces_in_name', () => {
  const processes = parseProcessList(
    [
      '100 1024 1.0 0.1 short',
      '200 4096 2.0 0.4 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '300 2048 0.5 0.2 middle',
    ].join('\n'),
  );

  assert.deepEqual(
    processes.map((item) => item.name),
    ['Google Chrome', 'middle', 'short'],
  );
  assert.equal(processes[0]?.rss, 4096 * 1024);
  assert.equal(processes[0]?.cpuPercent, 2);
  assert.equal(processes[0]?.memPercent, 0.4);
});

test('processes_parse_ignores_bad_and_limits_to_five', () => {
  const lines = ['bad line', '1 100 0.1 0.1 a', '2 200 0.1 0.1 b', '3 300 0.1 0.1 c', '4 400 0.1 0.1 d', '5 500 0.1 0.1 e', '6 600 0.1 0.1 f'];
  const processes = parseProcessList(lines.join('\n'));

  assert.equal(processes.length, 5);
  assert.equal(processes[0]?.name, 'f');
  assert.equal(processes[4]?.name, 'b');
});
