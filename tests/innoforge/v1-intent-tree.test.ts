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
    idempotencyKey: 'idem-v1',
    requestId: 'req-v1',
    occurredAt: '2026-10-22T13:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('V1 seed intent tree + scenario + forward-only collab stage', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 500,
  });
  const intent = await service.createIntent({
    id: 'forge:v1-1',
    statement: 'SaaS onboarding reduction',
    stake: 25,
    constraints: [{ key: 'cost', op: '<=', value: '10', unit: 'USD' }],
    scenario: 'PRODUCT',
    audit: audit({ idempotencyKey: 'v1-create' }),
  });
  assert.equal(intent.scenario, 'PRODUCT');
  assert.equal(intent.collabStage, 'DRAFT');
  assert.ok(intent.intentTree.nodes.some((n) => n.kind === 'GOAL'));
  assert.ok(intent.intentTree.nodes.some((n) => n.kind === 'CONSTRAINT'));
  assert.ok(intent.intentTree.nodes.some((n) => n.kind === 'SUCCESS'));

  const advanced = await service.updateIntent({
    id: 'forge:v1-1',
    collabStage: 'EXPLORING',
    audit: audit({
      idempotencyKey: 'v1-stage-1',
      occurredAt: '2026-10-22T13:01:00.000Z',
    }),
  });
  assert.equal(advanced.collabStage, 'EXPLORING');
  assert.ok(advanced.events.some((e) => e.type === 'forge.collab_stage.changed'));

  await assert.rejects(
    () => service.updateIntent({
      id: 'forge:v1-1',
      collabStage: 'COMMITTED',
      audit: audit({ idempotencyKey: 'v1-skip' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'COLLAB_STAGE_INVALID',
  );

  const root = intent.intentTree.nodes.find((n) => n.kind === 'GOAL')!;
  const tree = await service.addTreeNode({
    intentId: 'forge:v1-1',
    parentId: root.id,
    kind: 'BRANCH',
    title: 'Pricing experiment A',
    audit: audit({
      idempotencyKey: 'v1-branch',
      occurredAt: '2026-10-22T13:02:00.000Z',
    }),
  });
  const branch = tree.nodes.find((n) => n.title === 'Pricing experiment A');
  assert.ok(branch);
  const updated = await service.updateTreeNode({
    intentId: 'forge:v1-1',
    nodeId: branch!.id,
    status: 'ALIGNED',
    audit: audit({
      idempotencyKey: 'v1-align',
      occurredAt: '2026-10-22T13:03:00.000Z',
    }),
  });
  assert.equal(updated.nodes.find((n) => n.id === branch!.id)?.status, 'ALIGNED');

  const hw = await service.updateIntent({
    id: 'forge:v1-1',
    scenario: 'HARDWARE',
    audit: audit({
      idempotencyKey: 'v1-hw',
      occurredAt: '2026-10-22T13:04:00.000Z',
    }),
  });
  assert.equal(hw.scenario, 'HARDWARE');
});

test('V1 HTTP tree/scenario/stage + i18n nav', async () => {
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
        'idempotency-key': 'v1-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 600 },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'v1-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:v1-http',
        statement: 'HTTP intent tree',
        stake: 20,
        scenario: 'RESEARCH',
        constraints: [{ key: 'n', op: '>=', value: '3', unit: 'trials' }],
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().scenario, 'RESEARCH');
    assert.equal(created.json().collabStage, 'DRAFT');
    assert.ok(created.json().intentTree.nodes.length >= 2);

    const tree = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Av1-http/tree',
      headers: {
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(tree.statusCode, 200);
    const rootId = tree.json().tree.nodes.find((n: { kind: string }) => n.kind === 'GOAL').id;

    const added = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Av1-http/tree/nodes',
      headers: {
        'idempotency-key': 'v1-http-node',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { parent_id: rootId, kind: 'BRANCH', title: 'Hypothesis A' },
    });
    assert.equal(added.statusCode, 201);

    const staged = await app.inject({
      method: 'PATCH',
      url: '/v1/forge/intents/forge%3Av1-http',
      headers: {
        'idempotency-key': 'v1-http-stage',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { collab_stage: 'EXPLORING' },
    });
    assert.equal(staged.statusCode, 200);
    assert.equal(staged.json().collabStage, 'EXPLORING');

    const modes = await app.inject({ method: 'GET', url: '/v1/forge/scenario-modes' });
    assert.equal(modes.statusCode, 200);
    assert.deepEqual(modes.json().scenarios, ['PRODUCT', 'RESEARCH', 'HARDWARE']);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /navTree/);
    assert.match(i18n.body, /目标树/);
    assert.match(i18n.body, /Goal tree/);
    assert.match(i18n.body, /collabStageTitle/);

    const consoleJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(consoleJs.body, /intent-tree-panel/);
    assert.match(consoleJs.body, /collab-stage-panel/);
    assert.match(consoleJs.body, /\['tree', 'navTree'\]/);
  } finally {
    await app.close();
  }
});
