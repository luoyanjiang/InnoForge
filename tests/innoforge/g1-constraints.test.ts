import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { ForgeLoopError, InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import {
  legacyConstraintsFromStatement,
  normalizeConstraints,
} from '../../apps/forge-server/src/modules/innoforge/forge-constraints.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g1',
    requestId: 'req-g1',
    occurredAt: '2026-10-22T05:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('normalizeConstraints validates shape and legacy statement parse', () => {
  const normalized = normalizeConstraints([
    { key: 'mass', op: '<=', value: '180', unit: 'g' },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.key, 'mass');
  assert.throws(() => normalizeConstraints([{ key: 'x', op: '??', value: '1' }]), ForgeLoopError);
  const legacy = legacyConstraintsFromStatement('Hello\n\n[Mass ≤ 180g]');
  assert.equal(legacy[0]?.key, 'legacy');
  assert.match(legacy[0]?.value ?? '', /Mass/);
});

test('G1 create persists constraints; freeze blocks PATCH; unfreeze allows edit', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 500 });
  const constraints = [
    Object.freeze({ key: 'mass', op: '<=' as const, value: '180', unit: 'g' }),
    Object.freeze({ key: 'cost', op: '<=' as const, value: '12', unit: 'USD' }),
  ];
  const created = await service.createIntent({
    id: 'forge:g1-1',
    statement: 'Structural bracket with QC',
    stake: 20,
    constraints,
    audit: audit({ idempotencyKey: 'g1-create' }),
  });
  assert.equal(created.frozen, false);
  assert.equal(created.constraints.length, 2);
  assert.deepEqual(created.constraints[0], constraints[0]);

  const frozen = await service.updateIntent({
    id: 'forge:g1-1',
    frozen: true,
    audit: audit({ idempotencyKey: 'g1-freeze', occurredAt: '2026-10-22T05:01:00.000Z' }),
  });
  assert.equal(frozen.frozen, true);
  assert.ok(frozen.events.some((e) => e.type === 'forge.intent.frozen'));

  await assert.rejects(
    () => service.updateIntent({
      id: 'forge:g1-1',
      statement: 'Should fail while frozen',
      audit: audit({ idempotencyKey: 'g1-patch-frozen', occurredAt: '2026-10-22T05:02:00.000Z' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'INTENT_FROZEN',
  );

  const unfrozen = await service.updateIntent({
    id: 'forge:g1-1',
    frozen: false,
    audit: audit({ idempotencyKey: 'g1-unfreeze', occurredAt: '2026-10-22T05:03:00.000Z' }),
  });
  assert.equal(unfrozen.frozen, false);

  const updated = await service.updateIntent({
    id: 'forge:g1-1',
    statement: 'Structural bracket revised',
    constraints: [{ key: 'mass', op: '<=', value: '160', unit: 'g' }],
    audit: audit({ idempotencyKey: 'g1-update', occurredAt: '2026-10-22T05:04:00.000Z' }),
  });
  assert.equal(updated.statement, 'Structural bracket revised');
  assert.equal(updated.constraints[0]?.value, '160');
  assert.ok(updated.events.some((e) => e.type === 'forge.intent.updated'));

  await service.confirm({
    id: 'forge:g1-1',
    audit: audit({
      actorId: 'approver.demo',
      idempotencyKey: 'g1-confirm',
      occurredAt: '2026-10-22T05:05:00.000Z',
    }),
  });
  await service.deploy({
    id: 'forge:g1-1',
    audit: audit({ idempotencyKey: 'g1-deploy', occurredAt: '2026-10-22T05:06:00.000Z' }),
  });
  await assert.rejects(
    () => service.updateIntent({
      id: 'forge:g1-1',
      statement: 'too late',
      audit: audit({ idempotencyKey: 'g1-late', occurredAt: '2026-10-22T05:07:00.000Z' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'INTENT_NOT_EDITABLE',
  );
});

test('G1 HTTP create + PATCH freeze/unfreeze/edit', async () => {
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
        'idempotency-key': 'g1-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 400 },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g1-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g1-http',
        statement: 'HTTP constrained intent',
        stake: 15,
        constraints: [{ key: 'process', op: '=', value: 'FDM' }],
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().constraints[0].key, 'process');
    assert.equal(created.json().frozen, false);

    const frozen = await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Ag1-http',
      headers: {
        'idempotency-key': 'g1-http-freeze',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { frozen: true },
    });
    assert.equal(frozen.statusCode, 200);
    assert.equal(frozen.json().frozen, true);

    const blocked = await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Ag1-http',
      headers: {
        'idempotency-key': 'g1-http-blocked',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { statement: 'blocked' },
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, 'INTENT_FROZEN');

    const unfrozen = await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Ag1-http',
      headers: {
        'idempotency-key': 'g1-http-unfreeze',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { frozen: false },
    });
    assert.equal(unfrozen.statusCode, 200);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Ag1-http',
      headers: {
        'idempotency-key': 'g1-http-edit',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        statement: 'HTTP constrained intent v2',
        constraints: [{ key: 'process', op: '=', value: 'CNC' }],
      },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().statement, 'HTTP constrained intent v2');
    assert.equal(patched.json().constraints[0].value, 'CNC');

    const got = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Ag1-http',
      headers: { 'x-actor-id': 'user.demo', 'x-tenant-id': 'tenant.demo' },
    });
    assert.equal(got.statusCode, 200);
    assert.equal(got.json().constraints[0].value, 'CNC');

    const appJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(appJs.body, /wb-freeze/);
    assert.match(appJs.body, /constraintsEditorHtml/);
    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /intentFrozenHint/);
    assert.match(i18n.body, /unfreeze/);
  } finally {
    await app.close();
  }
});
