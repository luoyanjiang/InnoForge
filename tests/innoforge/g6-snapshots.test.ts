import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import {
  ForgeLoopError,
  InMemoryForgeLoopService,
} from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g6',
    requestId: 'req-g6',
    occurredAt: '2026-10-22T10:30:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('G6 snapshot then restore recovers statement/constraints; deploy blocks rollback', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 500 });
  await service.createIntent({
    id: 'forge:g6-1',
    statement: 'Original statement for snapshot',
    stake: 25,
    constraints: [{ key: 'qty', op: '<=', value: '10', unit: 'pcs' }],
    audit: audit({ idempotencyKey: 'g6-create' }),
  });

  const snap = await service.createSnapshot({
    intentId: 'forge:g6-1',
    audit: audit({ idempotencyKey: 'g6-snap', occurredAt: '2026-10-22T10:31:00.000Z' }),
  });
  assert.equal(snap.statement, 'Original statement for snapshot');
  assert.ok(snap.contentHash.length >= 16);
  assert.ok(snap.pxnTaskId);

  await service.updateIntent({
    id: 'forge:g6-1',
    statement: 'Mutated statement after snapshot',
    constraints: [{ key: 'qty', op: '<=', value: '99', unit: 'pcs' }],
    audit: audit({ idempotencyKey: 'g6-edit', occurredAt: '2026-10-22T10:32:00.000Z' }),
  });
  let intent = await service.get({ id: 'forge:g6-1', tenantId: 'tenant.demo' });
  assert.equal(intent?.statement, 'Mutated statement after snapshot');

  intent = await service.restoreSnapshot({
    intentId: 'forge:g6-1',
    snapshotId: snap.id,
    audit: audit({ idempotencyKey: 'g6-restore', occurredAt: '2026-10-22T10:33:00.000Z' }),
  });
  assert.equal(intent.statement, 'Original statement for snapshot');
  assert.equal(intent.constraints[0]?.value, '10');
  assert.ok(intent.events.some((e) => e.type === 'forge.intent.rolled_back'));

  await service.confirm({
    id: 'forge:g6-1',
    audit: audit({ idempotencyKey: 'g6-confirm', occurredAt: '2026-10-22T10:34:00.000Z' }),
  });
  await service.deploy({
    id: 'forge:g6-1',
    audit: audit({ idempotencyKey: 'g6-deploy', occurredAt: '2026-10-22T10:35:00.000Z' }),
  });

  await assert.rejects(
    () => service.createSnapshot({
      intentId: 'forge:g6-1',
      audit: audit({ idempotencyKey: 'g6-snap-late' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'SNAPSHOT_NOT_ALLOWED',
  );
  await assert.rejects(
    () => service.restoreSnapshot({
      intentId: 'forge:g6-1',
      snapshotId: snap.id,
      audit: audit({ idempotencyKey: 'g6-restore-late' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'ROLLBACK_NOT_ALLOWED',
  );
});

test('G6 HTTP create/list/restore snapshots + i18n', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    await app.inject({
      method: 'POST',
      url: '/v1/forge/accounts',
      headers: {
        'idempotency-key': 'g6-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 400 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g6-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g6-http',
        statement: 'HTTP snapshot original',
        stake: 15,
        constraints: [{ key: 'mass', op: '<=', value: '2', unit: 'kg' }],
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag6-http/snapshots',
      headers: {
        'idempotency-key': 'g6-http-snap',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(created.statusCode, 201);
    const snapId = created.json().id;

    await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Ag6-http',
      headers: {
        'idempotency-key': 'g6-http-edit',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { statement: 'HTTP snapshot mutated' },
    });

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/forge/intents/forge%3Ag6-http/snapshots/${encodeURIComponent(snapId)}/restore`,
      headers: {
        'idempotency-key': 'g6-http-restore',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().statement, 'HTTP snapshot original');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Ag6-http/snapshots',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().snapshots.length, 1);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /snapshotTitle/);
    assert.match(i18n.body, /快照 \/ 回滚/);
    assert.match(i18n.body, /Snapshots \/ rollback/);
  } finally {
    await app.close();
  }
});
