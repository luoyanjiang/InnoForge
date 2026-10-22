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
    idempotencyKey: 'idem-g7',
    requestId: 'req-g7',
    occurredAt: '2026-10-22T11:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

async function runToSettled(service: InMemoryForgeLoopService, intentId: string) {
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 1000,
  });
  await service.createIntent({
    id: intentId,
    statement: 'G7 lifeform fixture structural part',
    stake: 40,
    audit: audit({ idempotencyKey: `${intentId}-create` }),
  });
  await service.confirm({
    id: intentId,
    audit: audit({
      idempotencyKey: `${intentId}-confirm`,
      occurredAt: '2026-10-22T11:01:00.000Z',
    }),
  });
  await service.deploy({
    id: intentId,
    audit: audit({
      idempotencyKey: `${intentId}-deploy`,
      occurredAt: '2026-10-22T11:02:00.000Z',
    }),
  });
  let settled = false;
  for (let i = 0; i < 8 && !settled; i += 1) {
    const intent = await service.feedback({
      id: intentId,
      audit: audit({
        idempotencyKey: `${intentId}-fb-${i}`,
        occurredAt: `2026-10-22T11:${String(3 + i).padStart(2, '0')}:00.000Z`,
      }),
    });
    settled = intent.status === 'SETTLED';
  }
  assert.equal(settled, true);
}

test('G7 lifeform requires SETTLED; proposals + freeze/terminate state machine', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 500,
  });
  await service.createIntent({
    id: 'forge:g7-early',
    statement: 'Not settled yet',
    stake: 20,
    audit: audit({ idempotencyKey: 'g7-early-create' }),
  });
  await assert.rejects(
    () => service.createLifeform({
      intentId: 'forge:g7-early',
      audit: audit({ idempotencyKey: 'g7-early-life' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'LIFEFORM_REQUIRES_SETTLED',
  );

  await runToSettled(service, 'forge:g7-1');
  const lifeform = await service.createLifeform({
    intentId: 'forge:g7-1',
    name: 'Struct-G7',
    audit: audit({
      idempotencyKey: 'g7-create-life',
      occurredAt: '2026-10-22T11:20:00.000Z',
    }),
  });
  assert.equal(lifeform.status, 'ACTIVE');
  assert.equal(lifeform.name, 'Struct-G7');
  assert.equal(lifeform.proposals.length, 0);

  const again = await service.createLifeform({
    intentId: 'forge:g7-1',
    audit: audit({ idempotencyKey: 'g7-create-life-2' }),
  });
  assert.equal(again.id, lifeform.id);

  let next = await service.addLifeformProposal({
    lifeformId: lifeform.id,
    summary: 'Extend wing span +8%',
    audit: audit({
      idempotencyKey: 'g7-prop-1',
      occurredAt: '2026-10-22T11:21:00.000Z',
    }),
  });
  assert.equal(next.proposals.length, 1);
  assert.equal(next.proposals[0]?.status, 'PENDING');
  const proposalId = next.proposals[0]!.id;

  next = await service.decideLifeformProposal({
    lifeformId: lifeform.id,
    proposalId,
    decision: 'ACCEPTED',
    audit: audit({
      idempotencyKey: 'g7-accept',
      occurredAt: '2026-10-22T11:22:00.000Z',
    }),
  });
  assert.equal(next.proposals[0]?.status, 'ACCEPTED');
  assert.equal(next.proposals[0]?.decidedBy, 'user.demo');

  next = await service.addLifeformProposal({
    lifeformId: lifeform.id,
    summary: 'Rejectable skin texture',
    audit: audit({
      idempotencyKey: 'g7-prop-2',
      occurredAt: '2026-10-22T11:23:00.000Z',
    }),
  });
  const rejectId = next.proposals[1]!.id;
  next = await service.decideLifeformProposal({
    lifeformId: lifeform.id,
    proposalId: rejectId,
    decision: 'REJECTED',
    audit: audit({
      idempotencyKey: 'g7-reject',
      occurredAt: '2026-10-22T11:24:00.000Z',
    }),
  });
  assert.equal(next.proposals[1]?.status, 'REJECTED');

  next = await service.setLifeformStatus({
    lifeformId: lifeform.id,
    status: 'FROZEN',
    audit: audit({
      idempotencyKey: 'g7-freeze',
      occurredAt: '2026-10-22T11:25:00.000Z',
    }),
  });
  assert.equal(next.status, 'FROZEN');
  await assert.rejects(
    () => service.addLifeformProposal({
      lifeformId: lifeform.id,
      summary: 'Should fail while frozen',
      audit: audit({ idempotencyKey: 'g7-prop-frozen' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'LIFEFORM_NOT_ACTIVE',
  );

  next = await service.setLifeformStatus({
    lifeformId: lifeform.id,
    status: 'ACTIVE',
    audit: audit({
      idempotencyKey: 'g7-unfreeze',
      occurredAt: '2026-10-22T11:26:00.000Z',
    }),
  });
  assert.equal(next.status, 'ACTIVE');

  next = await service.setLifeformStatus({
    lifeformId: lifeform.id,
    status: 'TERMINATED',
    audit: audit({
      idempotencyKey: 'g7-term',
      occurredAt: '2026-10-22T11:27:00.000Z',
    }),
  });
  assert.equal(next.status, 'TERMINATED');
  await assert.rejects(
    () => service.setLifeformStatus({
      lifeformId: lifeform.id,
      status: 'ACTIVE',
      audit: audit({ idempotencyKey: 'g7-revive' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'LIFEFORM_TERMINATED',
  );

  const listed = await service.listLifeforms({ tenantId: 'tenant.demo' });
  assert.equal(listed.length, 1);
  assert.ok(listed[0]?.proposals.some((p) => p.status === 'ACCEPTED'));

  const intent = await service.get({ id: 'forge:g7-1', tenantId: 'tenant.demo' });
  const types = (intent?.events ?? []).map((e) => e.type);
  assert.ok(types.includes('forge.lifeform.created'));
  assert.ok(types.includes('forge.lifeform.proposal_accepted'));
  assert.ok(types.includes('forge.lifeform.proposal_rejected'));
  assert.ok(types.includes('forge.lifeform.frozen'));
  assert.ok(types.includes('forge.lifeform.terminated'));
});

test('G7 HTTP create/list/proposals/status + i18n', async () => {
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
        'idempotency-key': 'g7-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 800 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'g7-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:g7-http',
        statement: 'HTTP lifeform settled intent',
        stake: 30,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag7-http/confirm',
      headers: {
        'idempotency-key': 'g7-http-confirm',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Ag7-http/deploy',
      headers: {
        'idempotency-key': 'g7-http-deploy',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    for (let i = 0; i < 8; i += 1) {
      const fb = await app.inject({
        method: 'POST',
        url: '/v1/forge/intents/forge%3Ag7-http/feedback',
        headers: {
          'idempotency-key': `g7-http-fb-${i}`,
          'x-actor-id': 'user.demo',
          'x-tenant-id': 'tenant.demo',
        },
      });
      if (fb.json().status === 'SETTLED') break;
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/forge/lifeforms',
      headers: {
        'idempotency-key': 'g7-http-life-early',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { intent_id: 'forge:g7-http-missing' },
    });
    assert.equal(blocked.statusCode, 404);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/lifeforms',
      headers: {
        'idempotency-key': 'g7-http-life',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { intent_id: 'forge:g7-http', name: 'HTTP-Life' },
    });
    assert.equal(created.statusCode, 201);
    const lifeformId = created.json().id as string;
    assert.equal(created.json().status, 'ACTIVE');

    const prop = await app.inject({
      method: 'POST',
      url: `/v1/forge/lifeforms/${encodeURIComponent(lifeformId)}/proposals`,
      headers: {
        'idempotency-key': 'g7-http-prop',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { summary: 'HTTP evolution proposal' },
    });
    assert.equal(prop.statusCode, 201);
    const proposalId = prop.json().proposals[0].id as string;

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/forge/lifeforms/${encodeURIComponent(lifeformId)}/proposals/${encodeURIComponent(proposalId)}/decide`,
      headers: {
        'idempotency-key': 'g7-http-decide',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { decision: 'ACCEPTED' },
    });
    assert.equal(decided.statusCode, 200);
    assert.equal(decided.json().proposals[0].status, 'ACCEPTED');

    const frozen = await app.inject({
      method: 'POST',
      url: `/v1/forge/lifeforms/${encodeURIComponent(lifeformId)}/status`,
      headers: {
        'idempotency-key': 'g7-http-freeze',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { status: 'FROZEN' },
    });
    assert.equal(frozen.statusCode, 200);
    assert.equal(frozen.json().status, 'FROZEN');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/lifeforms',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().lifeforms.length, 1);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /lifeformPanel/);
    assert.match(i18n.body, /生命体生命周期/);
    assert.match(i18n.body, /Lifeform lifecycle/);

    const consoleJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(consoleJs.body, /lifeform-panel/);
    assert.match(consoleJs.body, /\/v1\/forge\/lifeforms/);
  } finally {
    await app.close();
  }
});
