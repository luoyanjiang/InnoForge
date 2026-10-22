import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SimulatorExternalAdapter,
  createDefaultSimulatorRegistry,
} from '../../adapters/external/simulator/src/simulator-external-adapters.js';
import { ExternalAdapterRegistry } from '../../apps/forge-server/src/modules/innoforge/external-registry.js';

test('default simulator registry covers InnoForge external catalog categories', async () => {
  const registry = new ExternalAdapterRegistry(createDefaultSimulatorRegistry());
  const adapters = registry.list();
  assert.ok(adapters.length >= 27);
  const categories = new Set(adapters.map(item => item.category));
  assert.deepEqual([...categories].sort(), [
    'commerce',
    'identity',
    'intelligence',
    'manufacturing',
    'observability',
    'supply_chain',
  ]);
  const health = await registry.healthAll();
  assert.ok(health.every(item => item.mode === 'simulator' && item.healthy));
});

test('simulator adapter advances queued → running → succeeded via tick', async () => {
  const adapter = new SimulatorExternalAdapter('mfg-fab', 'manufacturing', 2);
  const started = await adapter.createJob({
    jobId: 'job-1',
    payload: { intentId: 'forge:1' },
    at: '2026-10-18T02:00:00.000Z',
  });
  assert.equal(started.status, 'QUEUED');
  const running = await adapter.tick!('job-1', '2026-10-18T02:00:01.000Z');
  assert.equal(running.status, 'RUNNING');
  const done = await adapter.tick!('job-1', '2026-10-18T02:00:02.000Z');
  assert.equal(done.status, 'SUCCEEDED');
  assert.equal(done.result?.simulated, true);
});
