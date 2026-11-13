import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError } from '../../src/core/errors.ts';
import type { CapabilityModule, SessionHandle } from '../../src/core/manifest.ts';
import type { ExecPort, FilePort, TransferPort } from '../../src/core/ports.ts';
import { ModuleRegistry } from '../../src/core/registry.ts';
import { SessionService } from '../../src/core/session-service.ts';
import { createFakeSession } from '../helpers/fake-session.ts';

function setupService(handle: SessionHandle) {
  const registry = new ModuleRegistry();
  const module: CapabilityModule = {
    id: 'core-fake',
    kind: 'capability',
    builtin: true,
    apiVersion: '^1.0.0',
    provides: ['session'],
    activation: { onProtocol: 'fake' },
    setup: () => ({ exports: { openSession: () => handle }, dispose: () => {} }),
  };
  registry.register(module);
  registry.setupAll();

  const data: Array<{ sessionId: string; chunk: string }> = [];
  const exits: Array<{ sessionId: string; code: number | null }> = [];
  const service = new SessionService(registry, {
    onData: (sessionId, chunk) => data.push({ sessionId, chunk }),
    onExit: (sessionId, info) => exits.push({ sessionId, code: info.code }),
  });

  return { registry, service, data, exits };
}

test('session_service_open_returns_id_and_session_capability', async () => {
  const session = createFakeSession();
  const { service } = setupService({ session });

  const opened = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  assert.equal(opened.sessionId, 'fake-1');
  assert.deepEqual(opened.capabilities, ['session']);
});

test('session_service_capabilities_follow_actual_ports', async () => {
  const session = createFakeSession();
  const { service } = setupService({
    session,
    exec: {} as ExecPort,
    file: {} as FilePort,
    transfer: {} as TransferPort,
  });

  const opened = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  assert.deepEqual(opened.capabilities, ['session', 'exec', 'file', 'transfer']);
});

test('session_service_forwards_input_and_resize', async () => {
  const session = createFakeSession();
  const { service } = setupService({ session });
  const { sessionId } = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  service.write(sessionId, 'ls\r');
  service.resize(sessionId, 120, 40);

  assert.deepEqual(session.writes, ['ls\r']);
  assert.deepEqual(session.resizes, [{ cols: 120, rows: 40 }]);
});

test('session_service_forwards_output_and_exit_events', async () => {
  const session = createFakeSession();
  const { service, data, exits } = setupService({ session });
  const { sessionId } = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  session.emitData('hello');
  session.emitExit({ code: 0 });

  assert.deepEqual(data, [{ sessionId, chunk: 'hello' }]);
  assert.deepEqual(exits, [{ sessionId, code: 0 }]);
});

test('session_service_ignores_late_input_after_exit', async () => {
  const session = createFakeSession();
  const { service, exits } = setupService({ session });
  const { sessionId } = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  session.emitExit({ code: 1 });
  service.write(sessionId, 'x');
  service.resize(sessionId, 100, 30);

  assert.equal(exits.length, 1);
  assert.deepEqual(session.writes, []);
  assert.deepEqual(session.resizes, []);
});

test('session_service_close_is_idempotent', async () => {
  const session = createFakeSession();
  const { service } = setupService({ session });
  const { sessionId } = await service.open({ protocol: 'fake', cols: 80, rows: 24 });

  service.close(sessionId);
  service.close(sessionId);

  assert.equal(session.closed, true);
  assert.equal(session.closeCount, 1);
});

test('session_service_dispose_closes_every_session', async () => {
  const first = createFakeSession();
  const second = createFakeSession();
  const handles = [{ session: first }, { session: second }];
  let index = 0;

  const registry = new ModuleRegistry();
  registry.register({
    id: 'core-fake',
    kind: 'capability',
    builtin: true,
    apiVersion: '^1.0.0',
    provides: ['session'],
    activation: { onProtocol: 'fake' },
    setup: () => ({ exports: { openSession: () => handles[index++]! }, dispose: () => {} }),
  });
  registry.setupAll();
  const service = new SessionService(registry, { onData: () => {}, onExit: () => {} });

  await service.open({ protocol: 'fake', cols: 80, rows: 24 });
  await service.open({ protocol: 'fake', cols: 80, rows: 24 });
  service.dispose();

  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
});

test('session_service_unknown_protocol_throws_unsupported', async () => {
  const { service } = setupService({ session: createFakeSession() });

  await assert.rejects(
    service.open({ protocol: 'ssh', cols: 80, rows: 24 }),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
});

test('session_service_normalizes_open_failure', async () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'core-fake',
    kind: 'capability',
    builtin: true,
    apiVersion: '^1.0.0',
    provides: ['session'],
    activation: { onProtocol: 'fake' },
    setup: () => ({
      exports: {
        openSession: () => {
          throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:22'), { code: 'ECONNREFUSED' });
        },
      },
      dispose: () => {},
    }),
  });
  registry.setupAll();
  const service = new SessionService(registry, { onData: () => {}, onExit: () => {} });

  await assert.rejects(
    service.open({ protocol: 'fake', cols: 80, rows: 24 }),
    (error: unknown) =>
      error instanceof ProductError && error.code === 'HOST_UNREACHABLE' && error.detail?.includes('ECONNREFUSED') === true,
  );
});

test('session_service_module_without_open_session_throws_unsupported', async () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'core-fake',
    kind: 'capability',
    builtin: true,
    apiVersion: '^1.0.0',
    provides: ['session'],
    activation: { onProtocol: 'fake' },
    setup: () => ({ dispose: () => {} }),
  });
  registry.setupAll();
  const service = new SessionService(registry, { onData: () => {}, onExit: () => {} });

  await assert.rejects(
    service.open({ protocol: 'fake', cols: 80, rows: 24 }),
    (error: unknown) => error instanceof ProductError && error.code === 'UNSUPPORTED',
  );
});
