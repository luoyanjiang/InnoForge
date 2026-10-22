import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { ForgeLoopError, InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { forgeMessages, resolveLocale } from '../../apps/forge-server/src/modules/innoforge/i18n.js';

function audit(overrides: Partial<{ actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string }> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-1',
    requestId: 'req-1',
    occurredAt: '2026-10-18T02:10:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('i18n resolves zh by default and keeps locales unmixed', () => {
  assert.equal(resolveLocale(undefined), 'zh');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(forgeMessages('zh').createIntent, '创建意图');
  assert.equal(forgeMessages('en').createIntent, 'Create intent');
  assert.notEqual(forgeMessages('zh').title, forgeMessages('en').title);
});

test('closed loop stakes credit, requires confirm, deploys via gateway, settles on feedback', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({ tenantId: 'tenant.demo', principalId: 'user.demo', openingBalance: 200 });
  const created = await service.createIntent({
    id: 'forge:loop-1',
    statement: 'Small-batch structural prototype with QC feedback',
    stake: 40,
    adapterId: 'mfg-fab',
    audit: audit({ idempotencyKey: 'create-1' }),
  });
  assert.equal(created.status, 'STAKED');
  assert.ok(created.pxnTaskId);
  assert.equal(created.pxnPath?.mode, 'bridged');
  assert.equal((await service.getAccount({ tenantId: 'tenant.demo', principalId: 'user.demo' }))?.balance, 160);

  await assert.rejects(
    () => service.deploy({ id: 'forge:loop-1', audit: audit({ idempotencyKey: 'deploy-early' }) }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'CONFIRMATION_REQUIRED',
  );

  const confirmed = await service.confirm({
    id: 'forge:loop-1',
    audit: audit({ actorId: 'approver.demo', idempotencyKey: 'confirm-1', occurredAt: '2026-10-18T02:11:00.000Z' }),
  });
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.ok(confirmed.pxnPath?.approvalId);

  const deployed = await service.deploy({
    id: 'forge:loop-1',
    audit: audit({ idempotencyKey: 'deploy-1', occurredAt: '2026-10-18T02:12:00.000Z' }),
  });
  assert.equal(deployed.status, 'DEPLOYING');
  assert.equal(deployed.deployJob?.status, 'QUEUED');
  assert.ok(deployed.pxnPath?.routeQuoteId);
  assert.ok(deployed.pxnPath?.dispatchId);

  const mid = await service.feedback({
    id: 'forge:loop-1',
    audit: audit({ idempotencyKey: 'fb-1', occurredAt: '2026-10-18T02:13:00.000Z' }),
  });
  assert.equal(mid.status, 'FEEDBACK');

  const settled = await service.feedback({
    id: 'forge:loop-1',
    audit: audit({ idempotencyKey: 'fb-2', occurredAt: '2026-10-18T02:14:00.000Z' }),
  });
  assert.equal(settled.status, 'SETTLED');
  assert.equal(settled.creditMinted, 60);
  assert.equal(settled.pxnPath?.taskState, 'COMPLETED');
  // G4: empty suggester pool folds into proposer; confirmer (approver.demo) still gets 29.5%.
  const allocations = await service.listAllocations({
    intentId: 'forge:loop-1',
    tenantId: 'tenant.demo',
  });
  assert.equal(allocations.reduce((sum, item) => sum + item.amount, 0), 60);
  const proposerShare = allocations
    .filter((item) => item.principalId === 'user.demo')
    .reduce((sum, item) => sum + item.amount, 0);
  assert.equal(
    (await service.getAccount({ tenantId: 'tenant.demo', principalId: 'user.demo' }))?.balance,
    160 + proposerShare,
  );
  const confirmerShare = allocations
    .filter((item) => item.principalId === 'approver.demo')
    .reduce((sum, item) => sum + item.amount, 0);
  assert.ok(confirmerShare > 0);
  assert.equal(proposerShare + confirmerShare, 60);
});

test('HTTP routes expose designed console shell and forge loop APIs', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const consolePage = await app.inject({ method: 'GET', url: '/forge' });
    assert.equal(consolePage.statusCode, 200);
    assert.match(consolePage.body, /InnoForge/);
    assert.match(consolePage.body, /sidebar/);
    assert.match(consolePage.body, /forge\/app\.js/);

    const i18nAsset = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.equal(i18nAsset.statusCode, 200);
    assert.match(i18nAsset.body, /navWorkbench/);
    const appJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.equal(appJs.statusCode, 200);
    assert.match(appJs.body, /i18n\.js/);
    assert.match(appJs.body, /navConnections/);

    const i18n = await app.inject({ method: 'GET', url: '/v1/forge/i18n?locale=en' });
    assert.equal(i18n.statusCode, 200);
    assert.equal(i18n.json().locale, 'en');
    assert.equal(i18n.json().messages.createIntent, 'Create intent');

    await app.inject({
      method: 'POST',
      url: '/v1/forge/accounts',
      headers: {
        'idempotency-key': 'acct-http',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 500 },
    });

    const topped = await app.inject({
      method: 'POST',
      url: '/v1/forge/accounts/topup',
      headers: {
        'idempotency-key': 'topup-http',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { amount: 100 },
    });
    assert.equal(topped.statusCode, 200);
    assert.equal(topped.json().balance, 600);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'intent-http',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:http-1',
        statement: 'Deploy via controlled gateway',
        stake: 25,
        adapter_id: 'mfg-fab',
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, 'STAKED');
    assert.ok(created.json().pxnTaskId);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents',
      headers: { 'x-actor-id': 'user.demo', 'x-tenant-id': 'tenant.demo' },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().intents.length, 1);

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-1/confirm',
      headers: {
        'idempotency-key': 'confirm-http',
        'x-actor-id': 'approver.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(confirm.statusCode, 200);
    assert.equal(confirm.json().status, 'CONFIRMED');

    const deploy = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge:http-1/deploy',
      headers: {
        'idempotency-key': 'deploy-http',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
    });
    assert.equal(deploy.statusCode, 200);
    assert.equal(deploy.json().status, 'DEPLOYING');
  } finally {
    await app.close();
  }
});
