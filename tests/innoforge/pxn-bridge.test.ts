import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import {
  HttpPxnBridge,
  InMemoryForgePxnBridge,
  SimPxnBridge,
  createPxnBridge,
} from '../../apps/forge-server/src/modules/innoforge/pxn-bridge.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-bridge-1',
    requestId: 'req-bridge-1',
    occurredAt: '2026-10-18T04:40:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('createPxnBridge defaults to Sim and uses Http when PXN_BASE_URL set', () => {
  assert.ok(createPxnBridge({}) instanceof SimPxnBridge);
  assert.ok(createPxnBridge({ PXN_BASE_URL: 'http://127.0.0.1:3000' }) instanceof HttpPxnBridge);
});

test('closed loop attaches pxnPath and settles via bridged approvals path', async () => {
  const bridge = new InMemoryForgePxnBridge();
  const service = new InMemoryForgeLoopService(undefined, bridge);
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 200 });

  const created = await service.createIntent({
    id: 'forge:bridge-1',
    statement: 'Bridge create → adopt → confirm → deploy → feedback → settle',
    stake: 40,
    adapterId: 'mfg-fab',
    audit: audit({ idempotencyKey: 'create-bridge' }),
  });
  assert.equal(created.status, 'STAKED');
  assert.ok(created.pxnTaskId);
  assert.equal(created.pxnPath?.taskState, 'VALIDATED');
  assert.equal(created.pxnPath?.mode, 'bridged');
  assert.equal(created.pxnPath?.via, 'simulator');

  const confirmed = await service.confirm({
    id: 'forge:bridge-1',
    audit: audit({
      actorId: 'approver.demo',
      idempotencyKey: 'confirm-bridge',
      occurredAt: '2026-10-18T04:41:00.000Z',
    }),
  });
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.ok(confirmed.pxnPath?.approvalId);
  assert.equal(confirmed.pxnPath?.taskState, 'APPROVED');

  const deployed = await service.deploy({
    id: 'forge:bridge-1',
    audit: audit({ idempotencyKey: 'deploy-bridge', occurredAt: '2026-10-18T04:42:00.000Z' }),
  });
  assert.equal(deployed.status, 'DEPLOYING');
  assert.ok(deployed.pxnPath?.routeQuoteId);
  assert.ok(deployed.pxnPath?.dispatchId);
  assert.equal(deployed.pxnPath?.dispatchStatus, 'ACCEPTED');
  assert.ok(deployed.pxnPath?.evidencePackageId);
  assert.equal(deployed.pxnPath?.taskState, 'EXECUTING');
  assert.equal(deployed.pxnPath?.mode, 'robot_fk');

  const mid = await service.feedback({
    id: 'forge:bridge-1',
    audit: audit({ idempotencyKey: 'fb-bridge-1', occurredAt: '2026-10-18T04:43:00.000Z' }),
  });
  assert.equal(mid.status, 'FEEDBACK');

  const settled = await service.feedback({
    id: 'forge:bridge-1',
    audit: audit({ idempotencyKey: 'fb-bridge-2', occurredAt: '2026-10-18T04:44:00.000Z' }),
  });
  assert.equal(settled.status, 'SETTLED');
  assert.equal(settled.creditMinted, 60);
  assert.ok(settled.pxnPath?.acceptanceId);
  assert.equal(settled.pxnPath?.taskState, 'COMPLETED');
});

test('HTTP create→confirm→deploy→feedback→settle exposes pxnPath', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  const headers = (idem: string, actor = 'user.demo') => ({
    'idempotency-key': idem,
    'x-actor-id': actor,
    'x-tenant-id': 'tenant.demo',
  });
  try {
    await app.inject({
      method: 'POST',
      url: '/v1/forge/accounts',
      headers: headers('acct-bridge'),
      payload: { principal_id: 'user.demo', opening_balance: 500 },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: headers('intent-bridge'),
      payload: {
        intent_id: 'forge:http-bridge-1',
        statement: 'Full loop with PXN bridge',
        stake: 25,
        adapter_id: 'mfg-fab',
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, 'STAKED');
    assert.ok(created.json().pxnTaskId);
    assert.equal(created.json().pxnPath.taskState, 'VALIDATED');

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-bridge-1/confirm',
      headers: headers('confirm-bridge-http', 'approver.demo'),
    });
    assert.equal(confirm.statusCode, 200);
    assert.equal(confirm.json().status, 'CONFIRMED');
    assert.ok(confirm.json().pxnPath.approvalId);

    const deploy = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-bridge-1/deploy',
      headers: headers('deploy-bridge-http'),
    });
    assert.equal(deploy.statusCode, 200);
    assert.equal(deploy.json().status, 'DEPLOYING');
    assert.ok(deploy.json().pxnPath.routeQuoteId);
    assert.ok(deploy.json().pxnPath.dispatchId);
    assert.equal(deploy.json().pxnPath.dispatchStatus, 'ACCEPTED');

    const fb1 = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-bridge-1/feedback',
      headers: headers('fb1-bridge-http'),
    });
    assert.equal(fb1.statusCode, 200);
    assert.equal(fb1.json().status, 'FEEDBACK');

    const fb2 = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-bridge-1/feedback',
      headers: headers('fb2-bridge-http'),
    });
    assert.equal(fb2.statusCode, 200);
    assert.equal(fb2.json().status, 'SETTLED');
    assert.equal(fb2.json().creditMinted, 38);
    assert.equal(fb2.json().pxnPath.taskState, 'COMPLETED');
  } finally {
    await app.close();
  }
});
