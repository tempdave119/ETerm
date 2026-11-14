import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pluginCommandId } from '../../src/shared/plugins.ts';
import { PluginStore } from '../../src/services/plugins/store.ts';
import { PluginRuntime } from '../../src/host/plugin-runtime.ts';

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    kind: 'plugin',
    apiVersion: '^1.0.0',
    version: '0.1.0',
    description: 'demo plugin',
    author: 'tester',
    entry: 'index.cjs',
    commands: [{ id: 'hello', title: 'Hello' }],
    panels: [{ id: 'main', title: 'Main' }],
    ...overrides,
  };
}

async function createRuntime(entrySource: string) {
  const base = join(process.cwd(), 'tmp', 'tests', `plugin-runtime-${randomUUID()}`);
  await mkdir(base, { recursive: true });
  const logs: string[] = [];
  const store = new PluginStore({ baseDir: join(base, 'data'), logger: (message) => logs.push(message) });
  const source = join(base, 'source', 'demo');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest()), 'utf8');
  await writeFile(join(source, 'index.cjs'), entrySource, 'utf8');
  await store.install(source);
  const runtime = new PluginRuntime({ store, logger: (message) => logs.push(message) });
  return { logs, runtime, store };
}

function markerPath(name: string): string {
  return join(process.cwd(), 'tmp', `${name}-${randomUUID()}.txt`);
}

test('plugin_runtime_lists_and_runs_declared_commands', async () => {
  const marker = markerPath('plugin-command-marker');
  const { runtime } = await createRuntime(`
    const fs = require('node:fs');
    module.exports = {
      activate(api) {
        api.registerCommand('hello', () => {
          fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
        });
      },
    };
  `);

  await runtime.start();
  const commands = runtime.listCommands();
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.id, pluginCommandId('demo', 'hello'));
  assert.equal(commands[0]?.title, 'Hello');

  await runtime.runCommand(pluginCommandId('demo', 'hello'));
  assert.equal(await readFile(marker, 'utf8'), 'ok');
});

test('plugin_runtime_rejects_unknown_command', async () => {
  const { runtime } = await createRuntime('module.exports = { activate() {} };');
  await runtime.start();

  await assert.rejects(runtime.runCommand(pluginCommandId('demo', 'missing')), /未提供命令/);
  await assert.rejects(runtime.runCommand('terminal.new'), /未知插件命令/);
});

test('plugin_runtime_skips_plugin_without_activate', async () => {
  const { logs, runtime } = await createRuntime('module.exports = {};');

  await runtime.start();

  assert.deepEqual(runtime.listCommands(), []);
  assert.ok(logs.some((line) => line.includes('命令未加载')));
});

test('plugin_runtime_rejects_undeclared_command', async () => {
  const { logs, runtime } = await createRuntime(`
    module.exports = {
      activate(api) {
        api.registerCommand('nope', () => {});
      },
    };
  `);

  await runtime.start();

  assert.deepEqual(runtime.listCommands(), []);
  assert.ok(logs.some((line) => line.includes('命令未加载')));
});

test('plugin_runtime_dispose_calls_entry_dispose', async () => {
  const marker = markerPath('plugin-dispose-marker');
  const { runtime } = await createRuntime(`
    const fs = require('node:fs');
    module.exports = {
      activate(api) {
        api.registerCommand('hello', () => {});
      },
      dispose() {
        fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
      },
    };
  `);

  await runtime.start();
  runtime.dispose();

  assert.equal(await readFile(marker, 'utf8'), 'ok');
});

test('plugin_runtime_lists_nothing_when_plugin_disabled', async () => {
  const { runtime, store } = await createRuntime('module.exports = { activate() {} };');
  await store.setEnabled('demo', false);

  await runtime.start();

  assert.deepEqual(runtime.listCommands(), []);
});

test('plugin_runtime_routes_panel_messages', async () => {
  const { runtime } = await createRuntime(`
    module.exports = {
      activate(api) {
        api.registerPanelHandler('main', (payload) => ({ pong: payload.ping === true }));
      },
    };
  `);

  await runtime.start();

  assert.deepEqual(await runtime.handlePanelMessage('demo', 'main', { ping: true }), { pong: true });
  await assert.rejects(runtime.handlePanelMessage('demo', 'missing', {}), /未注册面板处理器/);
});

test('plugin_runtime_rejects_undeclared_panel_handler', async () => {
  const { logs, runtime } = await createRuntime(`
    module.exports = {
      activate(api) {
        api.registerPanelHandler('nope', () => null);
      },
    };
  `);

  await runtime.start();

  assert.ok(logs.some((line) => line.includes('命令未加载')));
});