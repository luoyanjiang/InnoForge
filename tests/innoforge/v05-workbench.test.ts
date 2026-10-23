import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import {
  ForgeLoopError,
  InMemoryForgeLoopService,
} from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import {
  WORKBENCH_DEMO_INTENT_ID,
  calcQuote,
  canSubmit,
  ruleMatchesRequirements,
} from '../../apps/forge-server/src/modules/innoforge/forge-workbench.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-wb',
    requestId: 'req-wb',
    occurredAt: '2026-10-22T16:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('v05 calcQuote + submit guards', () => {
  const q = calcQuote({ price: 800, threshold: 7, rate: 30 }, 3, 6);
  assert.equal(q?.base, 2400);
  assert.equal(q?.fee, 720);
  assert.equal(q?.total, 3120);
  assert.equal(calcQuote({ price: 800, threshold: 7, rate: 30 }, 3, 7)?.fee, 0);
});

test('v05 accept→build→checks→fix→submit→accept-delivery + ZIP', async () => {
  const service = new InMemoryForgeLoopService();
  const ensured = await service.ensureWorkbench({
    lang: 'zh',
    audit: audit({ idempotencyKey: 'wb-ensure' }),
  });
  assert.equal(ensured.intentId, WORKBENCH_DEMO_INTENT_ID);
  assert.equal(ensured.state.accepted, false);

  const accepted = await service.acceptWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'wb-accept',
      occurredAt: '2026-10-22T16:01:00.000Z',
    }),
  });
  assert.equal(accepted.state.accepted, true);
  assert.ok(accepted.state.locked);
  assert.equal(accepted.state.locked?.title, '轻舟报价器');
  assert.ok(accepted.state.taskId);

  const tasks = await service.listTasks({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    tenantId: 'tenant.demo',
  });
  assert.ok(tasks.some((t) => t.title.includes('T-01') || t.title.includes('报价')));

  const built = await service.buildWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    action: 'run',
    audit: audit({
      idempotencyKey: 'wb-build',
      occurredAt: '2026-10-22T16:02:00.000Z',
    }),
  });
  assert.equal(built.state.built, true);
  assert.equal(built.state.version, 1);
  assert.equal(built.state.budget.spent, 96);
  assert.ok(built.state.history.some((h) => h.mode === 'SIM'));
  // First draft intentionally mismatches R1 rush threshold (2x)
  assert.equal(built.state.rule?.threshold, 14);
  assert.equal(ruleMatchesRequirements(built.state), false);

  const checked = await service.runWorkbenchChecks({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'wb-check-1',
      occurredAt: '2026-10-22T16:03:00.000Z',
    }),
  });
  assert.ok(checked.state.tests);
  assert.ok(checked.state.tests!.results.some((r) => !r.pass));

  await assert.rejects(
    () => service.submitWorkbench({
      intentId: WORKBENCH_DEMO_INTENT_ID,
      audit: audit({ idempotencyKey: 'wb-submit-bad' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'WORKBENCH_SUBMIT_INVALID',
  );

  const fixed = await service.rulesWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    rule: {
      price: accepted.state.locked!.price,
      threshold: accepted.state.locked!.threshold,
      rate: accepted.state.locked!.rate,
    },
    audit: audit({
      idempotencyKey: 'wb-rules',
      occurredAt: '2026-10-22T16:04:00.000Z',
      actorId: 'user.demo',
    }),
  });
  assert.equal(fixed.state.version, 2);
  assert.equal(ruleMatchesRequirements(fixed.state), true);
  assert.equal(fixed.state.tests, null);

  // feedback open blocks submit until resolved — optional path: run checks then submit
  const rechecked = await service.runWorkbenchChecks({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'wb-check-2',
      occurredAt: '2026-10-22T16:05:00.000Z',
    }),
  });
  assert.ok(rechecked.state.tests!.results.every((r) => r.pass));

  // set role maker for submit
  const ready = await service.patchWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    patch: { role: 'maker', stage: 'craft' },
    audit: audit({ idempotencyKey: 'wb-role-maker' }),
  });
  assert.equal(canSubmit(ready.state), true);

  const submitted = await service.submitWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'wb-submit',
      occurredAt: '2026-10-22T16:06:00.000Z',
    }),
  });
  assert.ok(submitted.state.submitted);

  const asClient = await service.patchWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    patch: { role: 'client' },
    audit: audit({ idempotencyKey: 'wb-role-client' }),
  });
  assert.equal(asClient.state.role, 'client');

  const delivered = await service.acceptDeliveryWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'wb-accept-del',
      occurredAt: '2026-10-22T16:07:00.000Z',
    }),
  });
  assert.ok(delivered.state.acceptedDelivery);
  assert.equal(delivered.state.payable?.status, 'PAYABLE');
  assert.equal(delivered.state.payable?.paid, 0);
  assert.equal(delivered.state.payable?.amount, 600);

  const zip = await service.deliveryZipWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    tenantId: 'tenant.demo',
  });
  assert.ok(zip.buffer.length > 100);
  assert.match(zip.filename, /lightboat-delivery/);
  assert.equal(zip.buffer[0], 0x50); // P
  assert.equal(zip.buffer[1], 0x4b); // K
});

test('v05 HTTP workbench ensure + studio shell markers', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const ensure = await app.inject({
      method: 'POST',
      url: '/v1/forge/workbench/ensure',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
        'idempotency-key': 'http-wb-ensure',
        'content-type': 'application/json',
      },
      payload: { lang: 'zh' },
    });
    assert.equal(ensure.statusCode, 200);
    const body = ensure.json();
    assert.equal(body.intentId, WORKBENCH_DEMO_INTENT_ID);

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/forge/intents/${encodeURIComponent(WORKBENCH_DEMO_INTENT_ID)}/workbench/accept`,
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
        'idempotency-key': 'http-wb-accept',
        'content-type': 'application/json',
      },
      payload: {},
    });
    assert.equal(accept.statusCode, 200);

    const html = await app.inject({ method: 'GET', url: '/forge' });
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /workbench\.css/);
    assert.match(html.body, /forge\/app\.js/);

    const js = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(js.body, /mountStudioWorkbench|projectTabValidate|navProjects/);
    assert.match(js.body, /studio-host|renderProjectValidate|WORKBENCH_INTENT_ID/);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /projectTabValidate: '做事'|projectTabValidate: 'Work'|做事/);

    const wbJs = await app.inject({ method: 'GET', url: '/forge/workbench.js' });
    assert.equal(wbJs.statusCode, 200);
    assert.match(wbJs.body, /mountStudioWorkbench/);
  } finally {
    await app.close();
  }
});
