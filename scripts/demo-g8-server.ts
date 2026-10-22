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
  await app.inject({
    method: 'POST',
    url: '/v1/forge/intents',
    headers: { ...headers, 'idempotency-key': 'demo-create' },
    payload: {
      intent_id: 'forge:g8-demo',
      statement: '小批量结构件 · G8 Lumen 记忆演示',
      stake: 40,
      constraints: [{ key: 'qty', op: '<=', value: '16', unit: 'pcs' }],
    },
  });

  const m1 = await app.inject({
    method: 'POST',
    url: '/v1/forge/intents/forge%3Ag8-demo/memories',
    headers: { ...headers, 'idempotency-key': 'mem-1' },
    payload: { text: 'Prefer PETG for outdoor durability' },
  });
  await app.inject({
    method: 'POST',
    url: `/v1/forge/intents/forge%3Ag8-demo/memories/${encodeURIComponent(m1.json().id)}/promote`,
    headers: { ...headers, 'idempotency-key': 'mem-promote' },
    payload: {},
  });
  await app.inject({
    method: 'POST',
    url: '/v1/forge/intents/forge%3Ag8-demo/memories',
    headers: { ...headers, 'idempotency-key': 'mem-2' },
    payload: { text: 'Keep wall thickness >= 2mm' },
  });
  await app.inject({
    method: 'POST',
    url: '/v1/forge/intents/forge%3Ag8-demo/memories',
    headers: { ...headers, 'idempotency-key': 'mem-3' },
    payload: { text: 'Optional matte finish (pending)' },
  });
  console.log('seeded memories for forge:g8-demo');
}

await seed();
await app.listen({ host: '127.0.0.1', port: 3080 });
console.log('demo server ready on http://127.0.0.1:3080/forge');
