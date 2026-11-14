import test from 'node:test';
import assert from 'node:assert/strict';
import type { CapabilityModule } from '../../src/core/manifest.ts';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { ProductError } from '../../src/core/errors.ts';

interface ModuleOptions {
  id: string;
  protocol?: string;
  apiVersion?: string;
  consumes?: string[];
  setup?: CapabilityModule['setup'];
}

function makeModule(options: ModuleOptions): CapabilityModule {
  return {
    id: options.id,
    kind: 'capability',
    builtin: true,
    apiVersion: options.apiVersion ?? '^1.0.0',
    provides: ['session'],
    ...(options.consumes ? { consumes: options.consumes } : {}),
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

test('registry_failing_component_is_skipped_without_blocking_startup', () => {
  const calls: string[] = [];
  const registry = new ModuleRegistry();
  registry.register({
    ...makeModule({
      id: 'ext-bad',
      protocol: 'bad',
      setup: () => {
        throw new Error('boom');
      },
    }),
    builtin: false,
  });
  registry.register(
    makeModule({
      id: 'core-ok',
      protocol: 'ok',
      setup: () => {
        calls.push('ok');
        return { dispose: () => {} };
      },
    }),
  );

  registry.setupAll();

  assert.deepEqual(calls, ['ok']);
  // 失败组件声明的协议要释放，否则连接会路由到空实现。
  assert.throws(
    () => registry.moduleForProtocol('bad'),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
  assert.equal(registry.moduleForProtocol('ok').manifest.id, 'core-ok');
});

test('registry_setup_is_idempotent_for_late_modules', () => {
  const calls: string[] = [];
  const registry = new ModuleRegistry();
  registry.register(
    makeModule({
      id: 'core-a',
      setup: () => {
        calls.push('a');
        return { dispose: () => {} };
      },
    }),
  );

  registry.setupAll();
  registry.setupAll();
  assert.deepEqual(calls, ['a']);

  registry.register(
    makeModule({
      id: 'core-b',
      protocol: 'b',
      setup: () => {
        calls.push('b');
        return { dispose: () => {} };
      },
    }),
  );
  registry.setupAll();
  assert.deepEqual(calls, ['a', 'b']);
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
      consumes: ['echo'],
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

test('registry_undeclared_service_is_rejected', () => {
  const registry = new ModuleRegistry();
  registry.provide('credentials', { get: () => 'secret' });
  registry.register(
    makeModule({
      id: 'core-fake',
      setup: (ctx) => {
        ctx.get('credentials');
        return { dispose: () => {} };
      },
    }),
  );

  assert.throws(() => registry.setupAll(), /模块 core-fake 未声明服务 credentials/);
});

test('registry_declared_host_service_is_still_rejected', () => {
  const registry = new ModuleRegistry();
  registry.provide('connections', { ready: true });
  registry.register(
    makeModule({
      id: 'core-fake',
      consumes: ['connections'],
      setup: (ctx) => {
        ctx.get('connections');
        return { dispose: () => {} };
      },
    }),
  );

  assert.throws(() => registry.setupAll(), /宿主服务 connections 不对模块开放/);
});

test('registry_non_capability_kind_is_rejected', () => {
  const registry = new ModuleRegistry();
  const panel = { ...makeModule({ id: 'core-panel' }), kind: 'panel' } as unknown as CapabilityModule;

  assert.throws(() => registry.register(panel), /kind 必须是 capability/);
});

test('registry_duplicate_host_service_is_rejected', () => {
  const registry = new ModuleRegistry();
  registry.provide('connections', {});

  assert.throws(() => registry.provide('connections', {}), /服务名重复/);
});
