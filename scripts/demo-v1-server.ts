import { buildForgeApp } from '../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../apps/forge-server/src/modules/innoforge/forge-loop.js';

const service = new InMemoryForgeLoopService();
const app = await buildForgeApp({
  healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
  forgeLoopService: service,
  logger: false,
});

const headers = {
  'content-type': 'application/json',
  'x-tenant-id': 'tenant.demo',
  'x-actor-id': 'user.demo',
};

async function seed() {
  await app.inject({
    method: 'POST',
    url: '/v1/forge/accounts',
    headers: { ...headers, 'idempotency-key': 'demo-acct' },
    payload: { principal_id: 'user.demo', opening_balance: 5000 },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/v1/forge/intents',
    headers: { ...headers, 'idempotency-key': 'demo-create' },
    payload: {
      intent_id: 'forge:v1-demo',
      statement: '小批量结构件 · 产品意图树演示',
      stake: 40,
      scenario: 'PRODUCT',
      constraints: [
        { key: 'cost', op: '<=', value: '12', unit: 'USD' },
        { key: 'mass', op: '<=', value: '180', unit: 'g' },
      ],
    },
  });
  const root = created.json().intentTree.nodes.find((n: { kind: string }) => n.kind === 'GOAL');
  await app.inject({
    method: 'POST',
    url: '/v1/forge/intents/forge%3Av1-demo/tree/nodes',
    headers: { ...headers, 'idempotency-key': 'demo-branch' },
    payload: { parent_id: root.id, kind: 'BRANCH', title: 'PETG outdoor variant' },
  });
  await app.inject({
    method: 'PATCH',
    url: '/v1/forge/intents/forge%3Av1-demo',
    headers: { ...headers, 'idempotency-key': 'demo-stage' },
    payload: { collab_stage: 'EXPLORING' },
  });
  console.log('seeded forge:v1-demo');
}

await seed();
await app.listen({ host: '127.0.0.1', port: 3080 });
console.log('demo server ready on http://127.0.0.1:3080/forge');
