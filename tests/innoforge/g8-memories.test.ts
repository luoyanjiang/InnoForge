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
    idempotencyKey: 'idem-g8',
    requestId: 'req-g8',
    occurredAt: '2026-10-22T12:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('G8 create/list/forget/promote memory; promote appends consensus constraint', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 400,
  });
  await service.createIntent({
    id: 'forge:g8-1',
    statement: 'G8 memory fixture',
    stake: 20,
    constraints: [{ key: 'qty', op: '<=', value: '5', unit: 'pcs' }],
    audit: audit({ idempotencyKey: 'g8-create' }),
  });

  const created = await service.createMemory({
    intentId: 'forge:g8-1',
    text: 'Prefer PETG over PLA for outdoor parts',
    audit: audit({
      idempotencyKey: 'g8-mem-1',
      occurredAt: '2026-10-22T12:01:00.000Z',
    }),
  });
  assert.equal(created.status, 'ACTIVE');
  assert.equal(created.consensus, false);

  let listed = await service.listMemories({
    intentId: 'forge:g8-1',
    tenantId: 'tenant.demo',
  });
  assert.equal(listed.length, 1);

  const promoted = await service.promoteMemory({
    intentId: 'forge:g8-1',
    memoryId: created.id,
    audit: audit({
      idempotencyKey: 'g8-promote',
      occurredAt: '2026-10-22T12:02:00.000Z',
    }),
  });
  assert.equal(promoted.memory.status, 'PROMOTED');
  assert.equal(promoted.memory.consensus, true);
  assert.equal(promoted.memory.promotedConstraint?.key, 'consensus');
  assert.ok(promoted.intent.constraints.some((c) => c.key === 'consensus' && c.op === '~'));
  assert.ok(promoted.intent.events.some((e) => e.type === 'forge.memory.promoted'));

  await assert.rejects(
    () => service.forgetMemory({
      intentId: 'forge:g8-1',
      memoryId: created.id,
      audit: audit({ idempotencyKey: 'g8-forget-promoted' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'MEMORY_ALREADY_PROMOTED',
  );

  const other = await service.createMemory({
    intentId: 'forge:g8-1',
    text: 'Transient note to forget',
    audit: audit({
      idempotencyKey: 'g8-mem-2',
      occurredAt: '2026-10-22T12:03:00.000Z',
    }),
  });
  const forgotten = await service.forgetMemory({
    intentId: 'forge:g8-1',
    memoryId: other.id,
    audit: audit({
      idempotencyKey: 'g8-forget',
      occurredAt: '2026-10-22T12:04:00.000Z',
    }),
  });
  assert.equal(forgotten.status, 'FORGOTTEN');

  listed = await service.listMemories({
    intentId: 'forge:g8-1',
    tenantId: 'tenant.demo',
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.status, 'PROMOTED');

  const withForgotten = await service.listMemories({
    intentId: 'forge:g8-1',
    tenantId: 'tenant.demo',
    includeForgotten: true,
  });
  assert.equal(withForgotten.length, 2);

  await assert.rejects(
    () => service.createMemory({
      intentId: 'forge:g8-1',
      text: '   ',
      audit: audit({ idempotencyKey: 'g8-empty' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'MEMORY_TEXT_REQUIRED',
  );
});

test('G8 HTTP memories CRUD + promote + i18n', async () => {
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
        'idempotency-key': 'g8-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 500 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g8-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g8-http',
        statement: 'HTTP memory intent',
        stake: 15,
        constraints: [{ key: 'mass', op: '<=', value: '2', unit: 'kg' }],
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag8-http/memories',
      headers: {
        'idempotency-key': 'g8-http-mem',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { text: 'Keep wall thickness >= 2mm' },
    });
    assert.equal(created.statusCode, 201);
    const memoryId = created.json().id as string;

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Ag8-http/memories',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().memories.length, 1);

    const promoted = await app.inject({
      method: 'POST',
      url: `/v1/forge/intents/forge%3Ag8-http/memories/${encodeURIComponent(memoryId)}/promote`,
      headers: {
        'idempotency-key': 'g8-http-promote',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {},
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal(promoted.json().memory.status, 'PROMOTED');
    assert.ok(promoted.json().intent.constraints.some((c: { key: string }) => c.key === 'consensus'));

    const other = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag8-http/memories',
      headers: {
        'idempotency-key': 'g8-http-mem-2',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { text: 'Disposable preference' },
    });
    const forgetId = other.json().id as string;
    const forgotten = await app.inject({
      method: 'DELETE',
      url: `/v1/forge/intents/forge%3Ag8-http/memories/${encodeURIComponent(forgetId)}`,
      headers: {
        'idempotency-key': 'g8-http-forget',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(forgotten.statusCode, 200);
    assert.equal(forgotten.json().status, 'FORGOTTEN');

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /memoryModalTitle/);
    assert.match(i18n.body, /Lumen 记忆/);
    assert.match(i18n.body, /Lumen memories/);

    const consoleJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(consoleJs.body, /memory-modal/);
    assert.match(consoleJs.body, /\/memories/);
  } finally {
    await app.close();
  }
});
