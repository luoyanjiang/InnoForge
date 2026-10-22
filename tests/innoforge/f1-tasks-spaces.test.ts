import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import {
  ForgeLoopError,
  InMemoryForgeLoopService,
} from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { canAdvanceTaskStatus } from '../../apps/forge-server/src/modules/innoforge/forge-tasks.js';

function audit(overrides: Partial<{
  actorId: string; idempotencyKey: string; requestId: string; occurredAt: string; tenantId: string;
}> = {}) {
  return Object.freeze({
    actorId: 'user.demo',
    idempotencyKey: 'idem-f1',
    requestId: 'req-f1',
    occurredAt: '2026-10-22T14:00:00.000Z',
    tenantId: 'tenant.demo',
    ...overrides,
  });
}

test('F1 task status advances forward-only; FAILED allowed before DONE', () => {
  assert.equal(canAdvanceTaskStatus('PENDING', 'ASSIGNED'), true);
  assert.equal(canAdvanceTaskStatus('PENDING', 'IN_PROGRESS'), false);
  assert.equal(canAdvanceTaskStatus('REVIEW', 'DONE'), true);
  assert.equal(canAdvanceTaskStatus('DONE', 'FAILED'), false);
  assert.equal(canAdvanceTaskStatus('IN_PROGRESS', 'FAILED'), true);
});

test('F1 create/list/update tasks bound to tree nodes + spaces sim', async () => {
  const service = new InMemoryForgeLoopService();
  await service.ensureAccount({
    tenantId: 'tenant.demo',
    principalId: 'user.demo',
    openingBalance: 500,
  });
  const intent = await service.createIntent({
    id: 'forge:f1-1',
    statement: 'F1 create-flow shell',
    stake: 20,
    constraints: [{ key: 'latency', op: '<=', value: '100', unit: 'ms' }],
    scenario: 'RESEARCH',
    audit: audit({ idempotencyKey: 'f1-create' }),
  });
  const root = intent.intentTree.nodes.find((n) => n.kind === 'GOAL')!;
  const task = await service.createTask({
    intentId: intent.id,
    title: 'Literature gap scan',
    executor: 'AI',
    treeNodeId: root.id,
    audit: audit({
      idempotencyKey: 'f1-task-1',
      occurredAt: '2026-10-22T14:01:00.000Z',
    }),
  });
  assert.equal(task.executor, 'AI');
  assert.equal(task.status, 'PENDING');
  assert.equal(task.treeNodeId, root.id);

  const listed = await service.listTasks({
    intentId: intent.id,
    tenantId: 'tenant.demo',
  });
  assert.equal(listed.length, 1);

  const advanced = await service.updateTask({
    intentId: intent.id,
    taskId: task.id,
    status: 'ASSIGNED',
    executor: 'HUMAN',
    audit: audit({
      idempotencyKey: 'f1-task-adv',
      occurredAt: '2026-10-22T14:02:00.000Z',
    }),
  });
  assert.equal(advanced.status, 'ASSIGNED');
  assert.equal(advanced.executor, 'HUMAN');

  await assert.rejects(
    () => service.updateTask({
      intentId: intent.id,
      taskId: task.id,
      status: 'DONE',
      audit: audit({ idempotencyKey: 'f1-skip' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'TASK_STATUS_INVALID',
  );

  await assert.rejects(
    () => service.createTask({
      intentId: intent.id,
      title: 'bad node',
      treeNodeId: 'ftn:missing',
      audit: audit({ idempotencyKey: 'f1-bad-node' }),
    }),
    (error: unknown) => error instanceof ForgeLoopError && error.code === 'TREE_NODE_NOT_FOUND',
  );

  const spaces = await service.getSpaces({
    tenantId: 'tenant.demo',
    locale: 'zh',
  });
  assert.ok(spaces.personal.length >= 1);
  assert.ok(spaces.team.length >= 1);
  assert.ok(spaces.project.length >= 1);
  assert.match(spaces.note, /模拟|Sim/i);
});

test('F1 HTTP tasks + spaces routes + create-flow shell markers', async () => {
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
        'idempotency-key': 'f1-acct',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { principal_id: 'user.demo', opening_balance: 400 },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/forge/intents',
      headers: {
        'idempotency-key': 'f1-http-create',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        intent_id: 'forge:f1-http',
        statement: 'HTTP tasks route',
        stake: 15,
        scenario: 'PRODUCT',
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/forge/intents/forge%3Af1-http/tasks',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
        'idempotency-key': 'f1-http-task',
      },
      payload: { title: 'User problem framing', executor: 'AI' },
    });
    assert.equal(created.statusCode, 201);
    const taskBody = created.json();
    assert.equal(taskBody.title, 'User problem framing');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/forge/intents/forge%3Af1-http/tasks',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
      },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().tasks.length, 1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/forge/intents/forge%3Af1-http/tasks/${encodeURIComponent(taskBody.id)}`,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
        'idempotency-key': 'f1-http-patch',
      },
      payload: { status: 'ASSIGNED' },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().status, 'ASSIGNED');

    const spaces = await app.inject({
      method: 'GET',
      url: '/v1/forge/spaces?locale=en',
      headers: {
        'x-tenant-id': 'tenant.demo',
        'x-actor-id': 'user.demo',
      },
    });
    assert.equal(spaces.statusCode, 200);
    const spaceBody = spaces.json();
    assert.ok(Array.isArray(spaceBody.personal));
    assert.match(spaceBody.note, /Sim|sim/);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /navGroupIntent/);
    assert.match(i18n.body, /navTasks/);
    assert.match(i18n.body, /navSpaces/);
    assert.match(i18n.body, /创造流程操作系统/);
    assert.match(i18n.body, /Create-flow operating system/);

    const consoleJs = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.match(consoleJs.body, /NAV_GROUPS/);
    assert.match(consoleJs.body, /agent-strip/);
    assert.match(consoleJs.body, /tree-workspace/);
    assert.match(consoleJs.body, /renderTasks/);
    assert.match(consoleJs.body, /renderSpaces/);
  } finally {
    await app.close();
  }
});
