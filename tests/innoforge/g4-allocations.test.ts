import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import {
  DEFAULT_ALLOCATION_WEIGHTS,
  InMemoryForgeLoopService,
} from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { computeCreditAllocations } from '../../apps/forge-server/src/modules/innoforge/forge-allocations.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-g4',
    requestId: 'req-g4',
    occurredAt: '2026-10-22T09:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

async function runToSettled(service: InMemoryForgeLoopService, input: {
  intentId: string;
  stake: number;
  confirmerId: string;
  adoptBy?: string;
}) {
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 1000,
  });
  if (input.confirmerId !== 'user.demo') {
    await service.ensureAccount({
      tenantId: 'tenant.demo',
      principalId: input.confirmerId,
      openingBalance: 0,
    });
  }
  if (input.adoptBy && input.adoptBy !== 'user.demo') {
    await service.ensureAccount({
      tenantId: 'tenant.demo',
      principalId: input.adoptBy,
      openingBalance: 0,
    });
  }
  await service.createIntent({
    id: input.intentId,
    statement: 'G4 allocation fixture',
    stake: input.stake,
    audit: audit({ idempotencyKey: `${input.intentId}-create` }),
  });
  if (input.adoptBy) {
    await service.recordJudgment({
      intentId: input.intentId,
      candidateId: 'v1',
      action: 'ADOPT',
      audit: audit({
        actorId: input.adoptBy,
        idempotencyKey: `${input.intentId}-adopt`,
        occurredAt: '2026-10-22T09:01:00.000Z',
      }),
    });
  }
  await service.confirm({
    id: input.intentId,
    audit: audit({
      actorId: input.confirmerId,
      idempotencyKey: `${input.intentId}-confirm`,
      occurredAt: '2026-10-22T09:02:00.000Z',
    }),
  });
  await service.deploy({
    id: input.intentId,
    audit: audit({
      idempotencyKey: `${input.intentId}-deploy`,
      occurredAt: '2026-10-22T09:03:00.000Z',
    }),
  });
  let settled = false;
  for (let i = 0; i < 8 && !settled; i += 1) {
    const intent = await service.feedback({
      id: input.intentId,
      audit: audit({
        idempotencyKey: `${input.intentId}-fb-${i}`,
        occurredAt: `2026-10-22T09:${String(4 + i).padStart(2, '0')}:00.000Z`,
      }),
    });
    settled = intent.status === 'SETTLED';
  }
  assert.equal(settled, true);
}

test('G4 computeCreditAllocations fixed weights; empty suggesters fold into proposer', () => {
  assert.equal(
    DEFAULT_ALLOCATION_WEIGHTS.proposer
      + DEFAULT_ALLOCATION_WEIGHTS.suggester
      + DEFAULT_ALLOCATION_WEIGHTS.confirmer,
    100,
  );
  const solo = computeCreditAllocations({
    intentId: 'forge:x',
    tenantId: 'tenant.demo',
    minted: 100,
    proposerId: 'user.demo',
    suggesterIds: [],
    confirmerId: 'user.demo',
    occurredAt: '2026-10-22T09:00:00.000Z',
  });
  assert.equal(solo.reduce((sum, item) => sum + item.amount, 0), 100);
  const proposer = solo.find((item) => item.role === 'proposer');
  const confirmer = solo.find((item) => item.role === 'confirmer');
  assert.equal(proposer?.weightPercent, 70.5);
  assert.equal(confirmer?.weightPercent, 29.5);
  assert.equal((proposer?.amount ?? 0) + (confirmer?.amount ?? 0), 100);

  const withOther = computeCreditAllocations({
    intentId: 'forge:y',
    tenantId: 'tenant.demo',
    minted: 100,
    proposerId: 'user.demo',
    suggesterIds: ['advisor.demo'],
    confirmerId: 'approver.demo',
    occurredAt: '2026-10-22T09:00:00.000Z',
  });
  assert.equal(withOther.length, 3);
  assert.equal(withOther.reduce((sum, item) => sum + item.amount, 0), 100);
  const proposerAmt = withOther.find((item) => item.role === 'proposer')?.amount ?? 0;
  assert.ok(proposerAmt < 100);
  assert.ok(withOther.some((item) => item.role === 'suggester' && item.principalId === 'advisor.demo'));
});

test('G4 settle with external ADOPT splits Credit away from proposer-only', async () => {
  const service = new InMemoryForgeLoopService();
  const stake = 100;
  const minted = 150;
  await runToSettled(service, {
    intentId: 'forge:g4-split',
    stake,
    confirmerId: 'approver.demo',
    adoptBy: 'advisor.demo',
  });

  const allocations = await service.listAllocations({
    intentId: 'forge:g4-split',
    tenantId: 'tenant.demo',
  });
  assert.equal(allocations.reduce((sum, item) => sum + item.amount, 0), minted);
  const proposerAmt = allocations
    .filter((item) => item.principalId === 'user.demo')
    .reduce((sum, item) => sum + item.amount, 0);
  assert.ok(proposerAmt < minted, 'external adopt must not leave 100% with proposer');

  const proposer = await service.getAccount({ tenantId: 'tenant.demo', principalId: 'user.demo' });
  const advisor = await service.getAccount({ tenantId: 'tenant.demo', principalId: 'advisor.demo' });
  const approver = await service.getAccount({ tenantId: 'tenant.demo', principalId: 'approver.demo' });
  assert.equal(proposer?.staked, 0);
  // opening 1000 - stake 100 + proposer share
  assert.equal(
    (proposer?.balance ?? 0) + (advisor?.balance ?? 0) + (approver?.balance ?? 0),
    1000 - stake + minted,
  );
  assert.ok((advisor?.balance ?? 0) > 0);
  assert.ok((approver?.balance ?? 0) > 0);
});

test('G4 HTTP allocation-weights + allocations after settle', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const weights = await app.inject({ method: 'GET', url: '/v1/forge/allocation-weights' });
    assert.equal(weights.statusCode, 200);
    assert.equal(weights.json().weights.proposer, 38.5);

    await runToSettled(service, {
      intentId: 'forge:g4-http',
      stake: 40,
      confirmerId: 'approver.demo',
      adoptBy: 'advisor.demo',
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Ag4-http/allocations',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    const body = listed.json();
    assert.ok(body.allocations.length >= 2);
    assert.equal(
      body.allocations.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0),
      60,
    );

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /realizedTitle/);
    assert.match(i18n.body, /价值兑现/);
    assert.match(i18n.body, /Value realized/);
  } finally {
    await app.close();
  }
});
