import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { buildTimeline } from '../../apps/forge-server/src/modules/innoforge/forge-timeline.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g3',
    requestId: 'req-g3',
    occurredAt: '2026-10-22T07:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('G3 buildTimeline merges create → judgment → confirm → deploy → settle', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 500 });
  await service.createIntent({
    id: 'forge:g3-1',
    statement: 'Timeline chain prototype',
    stake: 25,
    audit: audit({ idempotencyKey: 'g3-create', occurredAt: '2026-10-22T07:00:00.000Z' }),
  });
  await service.recordJudgment({
    intentId: 'forge:g3-1',
    candidateId: 'v1',
    action: 'ADOPT',
    audit: audit({ idempotencyKey: 'g3-adopt', occurredAt: '2026-10-22T07:01:00.000Z' }),
  });
  await service.confirm({
    id: 'forge:g3-1',
    audit: audit({ idempotencyKey: 'g3-confirm', occurredAt: '2026-10-22T07:02:00.000Z' }),
  });
  await service.deploy({
    id: 'forge:g3-1',
    audit: audit({ idempotencyKey: 'g3-deploy', occurredAt: '2026-10-22T07:03:00.000Z' }),
  });
  // feedback may need multiple ticks to settle depending on adapter
  let settled = false;
  for (let i = 0; i < 8 && !settled; i += 1) {
    const minute = String(4 + i).padStart(2, '0');
    const intent = await service.feedback({
      id: 'forge:g3-1',
      audit: audit({
        idempotencyKey: `g3-fb-${i}`,
        occurredAt: `2026-10-22T07:${minute}:00.000Z`,
      }),
    });
    settled = intent.status === 'SETTLED';
  }
  assert.equal(settled, true);

  const items = await service.listTimeline({ tenantId: 'tenant.demo', intentId: 'forge:g3-1' });
  const kinds = items.map((item) => item.kind);
  assert.ok(kinds.includes('CREATED'));
  assert.ok(kinds.includes('JUDGMENT'));
  assert.ok(kinds.includes('CONFIRMED'));
  assert.ok(kinds.includes('DEPLOYED'));
  assert.ok(kinds.includes('SETTLED'));

  const judgment = items.find((item) => item.kind === 'JUDGMENT');
  assert.ok(judgment);
  assert.equal(judgment?.payload.action, 'ADOPT');
  assert.equal(judgment?.payload.candidateId, 'v1');
  assert.ok(typeof judgment?.payload.candidateTitleEn === 'string');

  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const curr = items[i];
    assert.ok(prev && curr && prev.at <= curr.at);
  }
});

test('G3 listTimeline filters by intent_id and returns empty for other tenants', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 200 });
  await service.createIntent({
    id: 'forge:g3-a',
    statement: 'A',
    stake: 10,
    audit: audit({ idempotencyKey: 'g3-a' }),
  });
  await service.createIntent({
    id: 'forge:g3-b',
    statement: 'B',
    stake: 10,
    audit: audit({ idempotencyKey: 'g3-b', occurredAt: '2026-10-22T07:10:00.000Z' }),
  });

  const filtered = await service.listTimeline({ tenantId: 'tenant.demo', intentId: 'forge:g3-a' });
  assert.ok(filtered.every((item) => item.intentId === 'forge:g3-a'));
  assert.ok(filtered.length >= 1);

  const all = await service.listTimeline({ tenantId: 'tenant.demo' });
  assert.ok(all.some((item) => item.intentId === 'forge:g3-a'));
  assert.ok(all.some((item) => item.intentId === 'forge:g3-b'));

  const other = await service.listTimeline({ tenantId: 'tenant.other' });
  assert.equal(other.length, 0);
});

test('G3 HTTP GET /v1/forge/timeline + i18n history keys', async () => {
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
        'idempotency-key': 'g3-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 300 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g3-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g3-http',
        statement: 'HTTP timeline',
        stake: 15,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag3-http/judgments',
      headers: {
        'idempotency-key': 'g3-http-adopt',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { candidate_id: 'v1', action: 'ADOPT' },
    });

    const timeline = await app.inject({
      method: 'GET',
      url: '/v1/forge/timeline?intent_id=forge%3Ag3-http',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(timeline.statusCode, 200);
    const body = timeline.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.some((item: { kind: string }) => item.kind === 'CREATED'));
    assert.ok(body.items.some((item: { kind: string }) => item.kind === 'JUDGMENT'));

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/forge/timeline?intent_id=forge%3Amissing',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(missing.statusCode, 404);

    const i18nZh = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18nZh.body, /navHistory/);
    assert.match(i18nZh.body, /historyTitle/);
    assert.match(i18nZh.body, /意图与判断历史/);
    assert.match(i18nZh.body, /Intent & judgment history/);
  } finally {
    await app.close();
  }
});

test('G3 buildTimeline does not duplicate judgment when event already present', () => {
  const items = buildTimeline({
    intents: [{
      id: 'forge:x',
      tenantId: 'tenant.demo',
      principalId: 'user.demo',
      statement: 'x',
      constraints: [],
      frozen: false,
      stake: 1,
      status: 'STAKED',
      adapterId: 'sim.mfg',
      createdAt: '2026-10-22T07:00:00.000Z',
      updatedAt: '2026-10-22T07:01:00.000Z',
      events: [{
        id: 'fev:1',
        type: 'forge.judgment.recorded',
        at: '2026-10-22T07:01:00.000Z',
        actorId: 'user.demo',
        payload: { judgmentId: 'j1', candidateId: 'v1', action: 'ADOPT' },
      }],
    }],
    judgments: [{
      id: 'j1',
      intentId: 'forge:x',
      tenantId: 'tenant.demo',
      actorId: 'user.demo',
      candidateId: 'v1',
      action: 'ADOPT',
      candidateSnapshot: {
        id: 'v1',
        tag: 'AI · Cost',
        titleEn: 'Ribs',
        titleZh: '加强筋',
        bodyEn: 's',
        bodyZh: 's',
        impact: 'high',
      },
      occurredAt: '2026-10-22T07:01:00.000Z',
    }],
  });
  assert.equal(items.filter((item) => item.kind === 'JUDGMENT').length, 1);
  assert.equal(items[0]?.payload.candidateTitleEn, 'Ribs');
});
