import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';
import { ForgeSseHub } from '../../apps/forge-server/src/modules/innoforge/sse-rooms.js';
import { PartnerGateway } from '../../apps/forge-server/src/modules/innoforge/partner-gateway.js';

test('SSE hub keeps tenant history and fans out publish', () => {
  const hub = new ForgeSseHub();
  const first = hub.publish({
    room: 'negotiate',
    tenantId: 'tenant.a',
    actorId: 'user.1',
    text: 'hello negotiate',
    at: '2026-10-18T04:00:00.000Z',
  });
  hub.publish({
    room: 'negotiate',
    tenantId: 'tenant.b',
    actorId: 'user.2',
    text: 'other tenant',
  });
  assert.equal(first.text, 'hello negotiate');
  assert.equal(hub.historyFor('negotiate', 'tenant.a').length, 1);
  assert.equal(hub.historyFor('negotiate', 'tenant.b').length, 1);
});

test('partner gateway simulator receiver and inbound callback', () => {
  const gateway = new PartnerGateway();
  const config = gateway.setConfig({
    tenantId: 'tenant.demo',
    outboundUrl: 'http://127.0.0.1:3000/v1/forge/partner/webhook-receiver',
    enabled: true,
  });
  assert.match(config.outboundUrl, /webhook-receiver/);
  const ack = gateway.receiveAsSimulator({
    tenantId: 'tenant.demo',
    body: { eventId: 'evt-1', kind: 'fab.job', tenantId: 'tenant.demo' },
  });
  assert.equal(ack.status, 'SIMULATED');
  assert.equal(ack.payload.qc, 'PASS');
  const inbound = gateway.receiveCallback({
    tenantId: 'tenant.demo',
    kind: 'fab.progress',
    payload: { progressPct: 50 },
  });
  assert.equal(inbound.direction, 'inbound');
  assert.ok(gateway.listEvents('tenant.demo').length >= 2);
});

test('HTTP partner config, callback, receiver, and SSE message routes', async () => {
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: new InMemoryForgeLoopService(),
  });
  try {
    const scenes = await app.inject({ method: 'GET', url: '/forge/r3f-scenes.js' });
    assert.equal(scenes.statusCode, 200);
    assert.match(scenes.body, /@react-three\/fiber/);

    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/forge/partner/config',
      headers: {
        'idempotency-key': 'cfg-1',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: {
        outbound_url: 'http://127.0.0.1:3000/v1/forge/partner/webhook-receiver',
        enabled: true,
      },
    });
    assert.equal(saved.statusCode, 200);

    const receiver = await app.inject({
      method: 'POST',
      url: '/v1/forge/partner/webhook-receiver',
      headers: { 'x-tenant-id': 'tenant.demo', 'content-type': 'application/json' },
      payload: { eventId: 'e1', kind: 'fab.job', tenantId: 'tenant.demo' },
    });
    assert.equal(receiver.statusCode, 200);
    assert.equal(receiver.json().ok, true);

    const callback = await app.inject({
      method: 'POST',
      url: '/v1/forge/partner/callbacks',
      headers: { 'x-actor-id': 'user.demo', 'x-tenant-id': 'tenant.demo' },
      payload: { kind: 'fab.progress', payload: { progressPct: 80 } },
    });
    assert.equal(callback.statusCode, 201);

    const events = await app.inject({
      method: 'GET',
      url: '/v1/forge/partner/events',
      headers: { 'x-actor-id': 'user.demo', 'x-tenant-id': 'tenant.demo' },
    });
    assert.equal(events.statusCode, 200);
    assert.ok(events.json().events.length >= 1);

    const posted = await app.inject({
      method: 'POST',
      url: '/v1/forge/sse/negotiate/messages',
      headers: {
        'idempotency-key': 'sse-1',
        'x-actor-id': 'user.demo',
        'x-tenant-id': 'tenant.demo',
      },
      payload: { text: 'negotiate ping' },
    });
    assert.equal(posted.statusCode, 201);
    assert.equal(posted.json().text, 'negotiate ping');
  } finally {
    await app.close();
  }
});
