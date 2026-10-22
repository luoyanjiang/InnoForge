import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { ForgeLoopError, InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g2',
    requestId: 'req-g2',
    occurredAt: '2026-10-22T06:20:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('G2 recordJudgment persists ADOPT/REJECT on responsibility chain', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 300 });
  await service.createIntent({
    id: 'forge:g2-1',
    statement: 'Judgment attribution prototype',
    stake: 20,
    audit: audit({ idempotencyKey: 'g2-create' }),
  });

  const candidates = await service.listVariantCandidates();
  assert.equal(candidates.length, 3);

  const adopted = await service.recordJudgment({
    intentId: 'forge:g2-1',
    candidateId: 'v1',
    action: 'ADOPT',
    audit: audit({ idempotencyKey: 'g2-adopt', occurredAt: '2026-10-22T06:21:00.000Z' }),
  });
  assert.equal(adopted.action, 'ADOPT');
  assert.equal(adopted.candidateId, 'v1');
  assert.equal(adopted.actorId, 'user.demo');
  assert.equal(adopted.candidateSnapshot.titleEn, 'Lattice reinforcing ribs');

  const again = await service.recordJudgment({
    intentId: 'forge:g2-1',
    candidateId: 'v1',
    action: 'ADOPT',
    audit: audit({ idempotencyKey: 'g2-adopt-again', occurredAt: '2026-10-22T06:22:00.000Z' }),
  });
  assert.equal(again.id, adopted.id);

  await assert.rejects(
    () => service.recordJudgment({
      intentId: 'forge:g2-1',
      candidateId: 'v1',
      action: 'REJECT',
      audit: audit({ idempotencyKey: 'g2-flip', occurredAt: '2026-10-22T06:23:00.000Z' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'JUDGMENT_ALREADY_RECORDED',
  );

  await service.recordJudgment({
    intentId: 'forge:g2-1',
    candidateId: 'v2',
    action: 'REJECT',
    audit: audit({
      actorId: 'reviewer.demo',
      idempotencyKey: 'g2-reject',
      occurredAt: '2026-10-22T06:24:00.000Z',
    }),
  });

  const listed = await service.listJudgments({ intentId: 'forge:g2-1', tenantId: 'tenant.demo' });
  assert.equal(listed.length, 2);
  assert.ok(listed.some((item) => item.action === 'REJECT' && item.actorId === 'reviewer.demo'));

  const intent = await service.get({ id: 'forge:g2-1', tenantId: 'tenant.demo' });
  assert.ok(intent?.events.some((event) => event.type === 'forge.judgment.recorded'));
});

test('G2 HTTP candidates + judgments adopt/reject with idempotency', async () => {
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
        'idempotency-key': 'g2-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 400 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g2-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g2-http',
        statement: 'HTTP judgment path',
        stake: 15,
      },
    });

    const catalog = await app.inject({ method: 'GET', url: '/v1/forge/variant-candidates' });
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().candidates.length, 3);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag2-http/judgments',
      headers: {
        'idempotency-key': 'g2-http-adopt',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { candidate_id: 'v3', action: 'ADOPT' },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().action, 'ADOPT');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag2-http/judgments',
      headers: {
        'idempotency-key': 'g2-http-adopt-2',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { candidate_id: 'v3', action: 'ADOPT' },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().id, created.json().id);

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag2-http/judgments',
      headers: {
        'idempotency-key': 'g2-http-reject-conflict',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { candidate_id: 'v3', action: 'REJECT' },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, 'JUDGMENT_ALREADY_RECORDED');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Ag2-http/judgments',
      headers: { 'x-actor-id': 'user.demo', 'x-tenant-id': 'tenant.demo' },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().judgments.length, 1);

    const appJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(appJs.body, /recordJudgment/);
    assert.match(appJs.body, /refreshVariantsAndJudgments/);
    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /judgmentBy/);
    assert.match(i18n.body, /rejectedToast/);
  } finally {
    await app.close();
  }
});
