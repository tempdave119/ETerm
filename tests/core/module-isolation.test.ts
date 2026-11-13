import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityModule } from '../../src/core/manifest.ts';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { ProductError } from '../../src/core/errors.ts';
import { localTerminalModule } from '../../src/modules/local-terminal/index.ts';
import { sshModule } from '../../src/modules/ssh/index.ts';

function boot(module: CapabilityModule): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(module);
  registry.setupAll();
  return registry;
}

function assertUnsupported(registry: ModuleRegistry, protocol: string): void {
  assert.throws(
    () => registry.moduleForProtocol(protocol),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
}

test('module_isolation_ssh_boots_without_local_terminal', () => {
  const registry = boot(sshModule);
  assert.equal(registry.moduleForProtocol('ssh').manifest.id, 'core-ssh');
  assertUnsupported(registry, 'local');
  registry.dispose();
});

test('module_isolation_local_terminal_boots_without_ssh', () => {
  const registry = boot(localTerminalModule);
  assert.equal(registry.moduleForProtocol('local').manifest.id, 'core-local-terminal');
  assertUnsupported(registry, 'ssh');
  registry.dispose();
});

/** 模块之间只能通过端口与 ctx 协作；直接 import 对方目录会让「拆模块」失效。 */
test('module_isolation_has_no_cross_module_imports', async () => {
  const modulesDir = join(process.cwd(), 'src', 'modules');
  const moduleDirs = (await readdir(modulesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const name of moduleDirs) {
    const files = (await readdir(join(modulesDir, name), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(modulesDir, name, entry.name));

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const otherModules = moduleDirs.filter((other) => other !== name);
      for (const other of otherModules) {
        assert.doesNotMatch(text, new RegExp(`modules/${other}/`), `${file} 不应 import ${other}`);
      }
      assert.doesNotMatch(text, /from '\.\.\/\.\.\/(shell|host)\//, `${file} 不应 import 外壳或宿主层`);
    }
  }
});
