import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { loadComponents } from '../../src/host/components.ts';

test('components_loads_serial_example_and_registers_protocol', async () => {
  const registry = new ModuleRegistry();
  const descriptors = await loadComponents({
    baseDir: join(process.cwd(), 'examples'),
    registry,
    logger: () => {},
  });

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0]?.protocol, 'serial');
  assert.equal(descriptors[0]?.label, '串口');
  assert.deepEqual(
    descriptors[0]?.fields.map((field) => field.key),
    ['path', 'baudRate', 'dataBits', 'stopBits', 'parity', 'flowControl', 'lineEnding', 'dtr', 'rts'],
  );
  // 设备下拉来自宿主枚举，布尔开关用于 DTR / RTS。
  assert.equal(descriptors[0]?.fields[0]?.optionsSource, 'serial-devices');
  assert.equal(descriptors[0]?.fields[7]?.type, 'boolean');

  registry.setupAll();
  const module = registry.moduleForProtocol('serial');
  assert.ok(module.exports.openSession);
});

test('components_skips_broken_manifest', async () => {
  const dir = join(process.cwd(), 'tmp', 'tests', `components-${randomUUID()}`);
  await mkdir(join(dir, 'components', 'broken'), { recursive: true });
  await writeFile(join(dir, 'components', 'broken', 'manifest.json'), '{ not json', 'utf8');

  const logs: string[] = [];
  const registry = new ModuleRegistry();
  const descriptors = await loadComponents({
    baseDir: dir,
    registry,
    logger: (message) => logs.push(message),
  });

  assert.deepEqual(descriptors, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /装载失败/);
});

test('components_returns_empty_when_directory_missing', async () => {
  const registry = new ModuleRegistry();
  const descriptors = await loadComponents({
    baseDir: join(process.cwd(), 'tmp', 'tests', `missing-${randomUUID()}`),
    registry,
    logger: () => {},
  });

  assert.deepEqual(descriptors, []);
});
