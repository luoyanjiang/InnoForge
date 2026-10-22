import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import {
  InMemoryForgeLoopService,
  REPUTATION_BASELINE,
} from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import {
  computeReputationScore,
  computeReputationTopPercent,
} from '../../apps/forge-server/src/modules/innoforge/forge-reputation.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g5',
    requestId: 'req-g5',
    occurredAt: '2026-10-22T10:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

async function settleWithAdopt(service: InMemoryForgeLoopService, intentId: string, actorId: string) {
  await service.createIntent({
    id: intentId,
    statement: `G5 ${intentId}`,
    stake: 20,
    audit: audit({
      actorId: 'user.demo',
      idempotencyKey: `${intentId}-create`,
    }),
  });
  await service.recordJudgment({
    intentId,
    candidateId: 'v1',
    action: 'ADOPT',
    audit: audit({
      actorId,
      idempotencyKey: `${intentId}-adopt`,
      occurredAt: '2026-10-22T10:01:00.000Z',
    }),
  });
  await service.confirm({
    id: intentId,
    audit: audit({
      idempotencyKey: `${intentId}-confirm`,
      occurredAt: '2026-10-22T10:02:00.000Z',
    }),
  });
  await service.deploy({
    id: intentId,
    audit: audit({
      idempotencyKey: `${intentId}-deploy`,
      occurredAt: '2026-10-22T10:03:00.000Z',
    }),
  });
  for (let i = 0; i < 8; i += 1) {
    const intent = await service.feedback({
      id: intentId,
      audit: audit({
        idempotencyKey: `${intentId}-fb-${i}`,
        occurredAt: `2026-10-22T10:${String(4 + i).padStart(2, '0')}:00.000Z`,
      }),
    });
    if (intent.status === 'SETTLED') return;
  }
  throw new Error('NOT_SETTLED');
}

test('G5 computeReputationScore baseline and clamps', () => {
  assert.equal(computeReputationScore({ adoptSettledCount: 0, rejectCount: 0 }), REPUTATION_BASELINE);
  assert.equal(computeReputationScore({ adoptSettledCount: 1, rejectCount: 0 }), 510);
  assert.equal(computeReputationScore({ adoptSettledCount: 0, rejectCount: 1 }), 498);
  assert.equal(computeReputationScore({ adoptSettledCount: 100, rejectCount: 0 }), 999);
  assert.equal(computeReputationScore({ adoptSettledCount: 0, rejectCount: 400 }), 0);
  assert.equal(
    computeReputationTopPercent({
      subjectId: 'a',
      scoresByPrincipal: new Map([['a', 500]]),
    }),
    null,
  );
  assert.equal(
    computeReputationTopPercent({
      subjectId: 'a',
      scoresByPrincipal: new Map([['a', 600], ['b', 500]]),
    }),
    50,
  );
});

test('G5 new account baseline; adopt+settle raises score', async () => {
  const service = new InMemoryForgeLoopService();
  const before = await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 800,
  });
  assert.equal(before.reputation.score, REPUTATION_BASELINE);
  assert.equal(before.reputation.topPercent, null);
  assert.equal(before.reputation.adoptSettledCount, 0);

  await settleWithAdopt(service, 'forge:g5-1', 'user.demo');
  const after = await service.getAccount({ tenantId: 'tenant.demo', principalId: 'user.demo' });
  assert.ok(after);
  assert.equal(after.reputation.score, 510);
  assert.equal(after.reputation.adoptSettledCount, 1);
  assert.ok(after.reputation.score > before.reputation.score);
});

test('G5 HTTP accounts/me returns reputation; i18n keys present', async () => {
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
        'idempotency-key': 'g5-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 400 },
    });
    await settleWithAdopt(service, 'forge:g5-http', 'user.demo');
    await service.ensureAccount({
      tenantId: 'tenant.demo',
      principalId: 'peer.demo',
      openingBalance: 100,
    });
    await service.createIntent({
      id: 'forge:g5-peer',
      statement: 'peer',
      stake: 10,
      audit: audit({ actorId: 'peer.demo', idempotencyKey: 'g5-peer-create' }),
    });
    await service.recordJudgment({
      intentId: 'forge:g5-peer',
      candidateId: 'v2',
      action: 'REJECT',
      audit: audit({
        actorId: 'peer.demo',
        idempotencyKey: 'g5-peer-reject',
        occurredAt: '2026-10-22T10:20:00.000Z',
      }),
    });

    const me = await app.inject({
      method: 'GET',
      url: '/v1/forge/accounts/me',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(me.statusCode, 200);
    const body = me.json();
    assert.equal(body.reputation.score, 510);
    assert.ok(body.reputation.topPercent === null || typeof body.reputation.topPercent === 'number');
    assert.notEqual(body.reputation.score, 842);

    const appJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.doesNotMatch(appJs.body, /stat-value">842</);
    assert.match(appJs.body, /account\?\.reputation/);
    assert.match(appJs.body, /reputationSubtext/);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /reputationSampleThin/);
    assert.match(i18n.body, /样本不足/);
    assert.match(i18n.body, /thin sample/);
  } finally {
    await app.close();
  }
});
