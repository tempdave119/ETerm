import test from 'node:test';
import assert from 'node:assert/strict';
import type { CapabilityModule } from '../../src/core/manifest.ts';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { ProductError } from '../../src/core/errors.ts';

interface ModuleOptions {
  id: string;
  protocol?: string;
  apiVersion?: string;
  setup?: CapabilityModule['setup'];
}

function makeModule(options: ModuleOptions): CapabilityModule {
  return {
    id: options.id,
    kind: 'capability',
    builtin: true,
    apiVersion: options.apiVersion ?? '^1.0.0',
    provides: ['session'],
    activation: { onProtocol: options.protocol ?? options.id },
    setup: options.setup ?? (() => ({ dispose: () => {} })),
  };
}

test('registry_duplicate_id_is_rejected', () => {
  const registry = new ModuleRegistry();
  registry.register(makeModule({ id: 'core-fake' }));

  assert.throws(() => registry.register(makeModule({ id: 'core-fake' })), /模块 id 重复/);
});

test('registry_incompatible_api_version_is_rejected', () => {
  const registry = new ModuleRegistry();

  assert.throws(() => registry.register(makeModule({ id: 'core-fake', apiVersion: '^2.0.0' })), /apiVersion/);
});

test('registry_duplicate_protocol_is_rejected', () => {
  const registry = new ModuleRegistry();
  registry.register(makeModule({ id: 'core-a', protocol: 'local' }));

  assert.throws(() => registry.register(makeModule({ id: 'core-b', protocol: 'local' })), /协议 local 已被模块 core-a 声明/);
});

test('registry_setup_requires_dispose', () => {
  const registry = new ModuleRegistry();
  registry.register(makeModule({ id: 'core-fake', setup: () => ({}) as never }));

  assert.throws(() => registry.setupAll(), /必须返回 dispose/);
});

test('registry_service_is_visible_to_later_modules_and_disposed_in_reverse', () => {
  const calls: string[] = [];
  const registry = new ModuleRegistry();

  registry.register(
    makeModule({
      id: 'core-first',
      protocol: 'first',
      setup: () => ({
        exports: { services: { echo: { value: 42 } } },
        dispose: () => calls.push('first'),
      }),
    }),
  );

  registry.register(
    makeModule({
      id: 'core-second',
      protocol: 'second',
      setup: (ctx) => {
        const echo = ctx.get<{ value: number }>('echo');
        calls.push(`second:${echo.value}`);
        return { dispose: () => calls.push('second') };
      },
    }),
  );

  registry.setupAll();
  assert.deepEqual(calls, ['second:42']);

  registry.dispose();
  assert.deepEqual(calls, ['second:42', 'second', 'first']);
});

test('registry_unknown_protocol_throws_unsupported', () => {
  const registry = new ModuleRegistry();
  registry.register(makeModule({ id: 'core-fake', protocol: 'fake' }));
  registry.setupAll();

  assert.throws(
    () => registry.moduleForProtocol('ssh'),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
});

test('registry_missing_service_throws_with_name', () => {
  const registry = new ModuleRegistry();
  registry.register(makeModule({ id: 'core-fake' }));
  registry.setupAll();

  assert.throws(() => registry.getService('vault'), /服务未提供：vault/);
});
