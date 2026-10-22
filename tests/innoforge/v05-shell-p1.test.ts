import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { DEMO_PROJECT_SPECS } from '../../apps/forge-server/src/modules/innoforge/forge-projects.js';
import { WORKBENCH_DEMO_INTENT_ID } from '../../apps/forge-server/src/modules/innoforge/forge-workbench.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-shell',
    requestId: 'req-shell',
    occurredAt: '2026-10-22T20:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('P1 ensure-demo yields ≥2 projects; my-tasks aggregates', async () => {
  const service = new InMemoryForgeLoopService();
  const projects = await service.ensureDemoProjects({
    audit: audit({ idempotencyKey: 'shell-ensure' }),
    locale: 'zh',
  });
  assert.ok(projects.length >= DEMO_PROJECT_SPECS.length);
  assert.ok(projects.some((p) => p.id === WORKBENCH_DEMO_INTENT_ID));
  assert.ok(projects.some((p) => p.id === 'forge:studio-hoshino'));

  await service.acceptWorkbench({
    intentId: WORKBENCH_DEMO_INTENT_ID,
    audit: audit({
      idempotencyKey: 'shell-accept',
      occurredAt: '2026-10-22T20:01:00.000Z',
    }),
  });
  const my = await service.listMyTasks({
    tenantId: 'tenant.demo',
    actorId: 'user.demo',
    locale: 'zh',
  });
  assert.ok(my.length >= 1);
  assert.ok(my.every((row) => row.projectId && row.projectName));
});

test('P1 HTTP projects + my-tasks + shell IA markers', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const ensure = await app.inject({
      method: 'POST',
      url: '/v1/forge/projects/ensure-demo',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
        'idempotency-key': 'http-shell-ensure',
        'content-type': 'application/json',
      },
      payload: { lang: 'zh' },
    });
    assert.equal(ensure.statusCode, 200);
    assert.ok(ensure.json().projects.length >= 2);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/projects?locale=en',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    assert.ok(listed.json().projects.some((p: { name: string }) => p.name === 'Lightboat' || p.name.includes('Light')));

    const my = await app.inject({
      method: 'GET',
      url: '/v1/forge/my-tasks',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
      },
    });
    assert.equal(my.statusCode, 200);
    assert.ok(Array.isArray(my.json().tasks));

    const js = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(js.body, /navProjects/);
    assert.match(js.body, /navMyTasks/);
    assert.match(js.body, /projectTabValidate/);
    assert.match(js.body, /openProject/);
    assert.doesNotMatch(js.body, /id: 'studio',\s*labelKey: 'navGroupStudio'/);
    // No top-level tasks nav item in primary group
    assert.match(js.body, /navGroupPrimary/);
    assert.match(js.body, /navGroupLoop/);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /navProjects: '项目'/);
    assert.match(i18n.body, /navMyTasks: 'My tasks'/);
    assert.match(i18n.body, /projectTabEvidence/);
  } finally {
    await app.close();
  }
});
