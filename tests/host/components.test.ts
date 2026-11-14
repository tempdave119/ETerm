import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { loadComponents } from '../../src/host/components.ts';

test('components_load_examples_and_register_protocols', async () => {
  const registry = new ModuleRegistry();
  const descriptors = await loadComponents({
    baseDir: join(process.cwd(), 'examples'),
    registry,
    logger: () => {},
  });

  assert.equal(descriptors.length, 2);
  const serial = descriptors.find((item) => item.protocol === 'serial');
  const telnet = descriptors.find((item) => item.protocol === 'telnet');
  assert.equal(serial?.label, '串口');
  assert.deepEqual(
    serial?.fields.map((field) => field.key),
    ['path', 'baudRate', 'dataBits', 'stopBits', 'parity', 'flowControl', 'lineEnding', 'dtr', 'rts'],
  );
  // 设备下拉来自宿主枚举，布尔开关用于 DTR / RTS。
  assert.equal(serial?.fields[0]?.optionsSource, 'serial-devices');
  assert.equal(serial?.fields[7]?.type, 'boolean');
  assert.equal(telnet?.label, 'Telnet');
  assert.deepEqual(telnet?.fields.map((field) => field.key), ['host', 'port']);

  registry.setupAll();
  assert.ok(registry.moduleForProtocol('serial').exports.openSession);
  assert.ok(registry.moduleForProtocol('telnet').exports.openSession);
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
