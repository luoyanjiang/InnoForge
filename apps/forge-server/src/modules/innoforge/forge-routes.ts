import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { forgeMessages, resolveLocale, type ForgeLocale } from './i18n.js';
import { ForgeLoopError, type ForgeAudit, type ForgeLoopService } from './forge-loop.js';
import { ForgePxnBridgeError } from './pxn-bridge.js';
import { forgeSseHub, type SseRoomKind } from './sse-rooms.js';
import { PartnerGatewayError, partnerGateway } from './partner-gateway.js';

const id = { type: 'string', minLength: 1, maxLength: 512 } as const;
const response = { type: 'object', additionalProperties: true } as const;
const errorResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'request_id'],
  properties: { error: { type: 'string' }, request_id: { type: 'string' } },
} as const;
const headers = {
  type: 'object',
  required: ['idempotency-key', 'x-actor-id', 'x-tenant-id'],
  properties: {
    'idempotency-key': id,
    'x-actor-id': id,
    'x-tenant-id': id,
  },
} as const;
const readHeaders = {
  type: 'object',
  required: ['x-actor-id', 'x-tenant-id'],
  properties: { 'x-actor-id': id, 'x-tenant-id': id },
} as const;

type Headers = { 'idempotency-key': string; 'x-actor-id': string; 'x-tenant-id': string };

function audit(request: FastifyRequest<{ Headers: Headers }>): ForgeAudit {
  return Object.freeze({
    actorId: request.headers['x-actor-id'],
    idempotencyKey: request.headers['idempotency-key'],
    requestId: request.id,
    occurredAt: new Date().toISOString(),
    tenantId: request.headers['x-tenant-id'],
  });
}

async function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const code = error instanceof ForgeLoopError || error instanceof ForgePxnBridgeError
    || (error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string'
      && /^(APPROVER_|TASK_|REQUESTER_|ACTIVE_|REVISION_|PXN_)/.test((error as { code: string }).code))
    ? (error as { code: string }).code
    : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') request.log.error({ err: error }, 'innoforge loop failed');
  const status = code === 'INTERNAL_ERROR' ? 500
    : code === 'TENANT_SCOPE_MISMATCH' ? 403
    : code.endsWith('NOT_FOUND') ? 404
    : 409;
  return reply.code(status).send({ error: code, request_id: request.id });
}

function consoleRoot(): string {
  // innoforge → modules → src → forge-server → apps/forge-console
  return join(dirname(fileURLToPath(import.meta.url)), '../../../../forge-console');
}

export function registerForgeRoutes(app: FastifyInstance, service: ForgeLoopService): void {
  app.get('/forge', async (_request, reply) => {
    const html = readFileSync(join(consoleRoot(), 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });
  app.get('/forge/app.js', async (_request, reply) => {
    const js = readFileSync(join(consoleRoot(), 'app.js'), 'utf8');
    return reply.type('application/javascript; charset=utf-8').send(js);
  });
  app.get('/forge/styles.css', async (_request, reply) => {
    const css = readFileSync(join(consoleRoot(), 'styles.css'), 'utf8');
    return reply.type('text/css; charset=utf-8').send(css);
  });
  app.get('/forge/i18n.js', async (_request, reply) => {
    const js = readFileSync(join(consoleRoot(), 'i18n.js'), 'utf8');
    return reply.type('application/javascript; charset=utf-8').send(js);
  });
  app.get('/forge/r3f-scenes.js', async (_request, reply) => {
    const js = readFileSync(join(consoleRoot(), 'r3f-scenes.js'), 'utf8');
    return reply.type('application/javascript; charset=utf-8').send(js);
  });

  app.get<{ Querystring: { locale?: string } }>('/v1/forge/i18n', {
    schema: {
      operationId: 'getForgeI18n',
      summary: 'InnoForge console locale strings (zh default / en)',
      tags: ['InnoForge'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { locale: { type: 'string', enum: ['zh', 'en'] } },
      },
      response: { 200: response },
    },
  }, async (request) => {
    const locale: ForgeLocale = resolveLocale(request.query.locale);
    return { locale, messages: forgeMessages(locale) };
  });

  app.get('/v1/forge/adapters', {
    schema: {
      operationId: 'listForgeAdapters',
      summary: 'List external adapter registry (simulator by default)',
      tags: ['InnoForge'],
      response: { 200: response },
    },
  }, async () => ({ adapters: await service.listAdapters() }));

  app.post<{
    Headers: Headers;
    Body: { principal_id: string; opening_balance?: number };
  }>('/v1/forge/accounts', {
    schema: {
      operationId: 'ensureForgeAccount',
      summary: 'Ensure a Credit account for the principal (demo ledger)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['principal_id'],
        properties: {
          principal_id: id,
          opening_balance: { type: 'number', exclusiveMinimum: 0 },
        },
      },
      response: { 200: response, 403: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    if (request.headers['x-actor-id'] !== request.body.principal_id) {
      return fail(request, reply, new ForgeLoopError('TENANT_SCOPE_MISMATCH'));
    }
    try {
      return reply.send(await service.ensureAccount({
        tenantId: request.headers['x-tenant-id'],
        principalId: request.body.principal_id,
        ...(request.body.opening_balance !== undefined
          ? { openingBalance: request.body.opening_balance }
          : {}),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{ Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'> }>('/v1/forge/accounts/me', {
    schema: {
      operationId: 'getForgeAccount',
      summary: 'Read Credit balance + judgment reputation for the calling principal (G5)',
      tags: ['InnoForge'],
      headers: readHeaders,
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    const account = await service.getAccount({
      tenantId: request.headers['x-tenant-id'],
      principalId: request.headers['x-actor-id'],
    });
    return account
      ? reply.send(account)
      : reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', request_id: request.id });
  });

  app.post<{
    Headers: Headers;
    Body: { amount: number };
  }>('/v1/forge/accounts/topup', {
    schema: {
      operationId: 'topUpForgeAccount',
      summary: 'Simulator Credit top-up (commerce adapter placeholder)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['amount'],
        properties: { amount: { type: 'number', exclusiveMinimum: 0 } },
      },
      response: { 200: response, 403: errorResponse, 409: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.topUp({
        tenantId: request.headers['x-tenant-id'],
        principalId: request.headers['x-actor-id'],
        amount: request.body.amount,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{ Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'> }>('/v1/forge/intents', {
    schema: {
      operationId: 'listForgeIntents',
      summary: 'List forge intents for the tenant',
      tags: ['InnoForge'],
      headers: readHeaders,
      response: { 200: response },
    },
  }, async (request) => ({
    intents: await service.listIntents({ tenantId: request.headers['x-tenant-id'] }),
  }));

  const constraintItem = {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'op', 'value'],
    properties: {
      key: { type: 'string', minLength: 1, maxLength: 128 },
      op: { type: 'string', enum: ['<=', '>=', '<', '>', '=', '~'] },
      value: { type: 'string', minLength: 1, maxLength: 512 },
      unit: { type: 'string', minLength: 1, maxLength: 64 },
    },
  } as const;

  app.post<{
    Headers: Headers;
    Body: {
      intent_id: string;
      statement: string;
      stake: number;
      constraints?: Array<{ key: string; op: string; value: string; unit?: string }>;
      adapter_id?: string;
      pxn_task_id?: string;
    };
  }>('/v1/forge/intents', {
    schema: {
      operationId: 'createForgeIntent',
      summary: 'Create intent with Credit stake (Intent OS expression cost)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['intent_id', 'statement', 'stake'],
        properties: {
          intent_id: id,
          statement: { type: 'string', minLength: 1, maxLength: 8000 },
          stake: { type: 'number', exclusiveMinimum: 0 },
          constraints: { type: 'array', maxItems: 32, items: constraintItem },
          adapter_id: id,
          pxn_task_id: id,
        },
      },
      response: {
        201: response,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    try {
      return reply.code(201).send(await service.createIntent({
        id: request.body.intent_id,
        statement: request.body.statement,
        stake: request.body.stake,
        ...(request.body.constraints !== undefined ? { constraints: request.body.constraints } : {}),
        ...(request.body.adapter_id !== undefined ? { adapterId: request.body.adapter_id } : {}),
        ...(request.body.pxn_task_id !== undefined ? { pxnTaskId: request.body.pxn_task_id } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch<{
    Headers: Headers;
    Params: { intentId: string };
    Body: {
      statement?: string;
      constraints?: Array<{ key: string; op: string; value: string; unit?: string }>;
      frozen?: boolean;
    };
  }>('/v1/forge/intents/:intentId', {
    schema: {
      operationId: 'updateForgeIntent',
      summary: 'Edit statement/constraints or freeze/unfreeze intent card (G1)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          statement: { type: 'string', minLength: 1, maxLength: 8000 },
          constraints: { type: 'array', maxItems: 32, items: constraintItem },
          frozen: { type: 'boolean' },
        },
      },
      response: {
        200: response,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.updateIntent({
        id: request.params.intentId,
        ...(request.body.statement !== undefined ? { statement: request.body.statement } : {}),
        ...(request.body.constraints !== undefined ? { constraints: request.body.constraints } : {}),
        ...(request.body.frozen !== undefined ? { frozen: request.body.frozen } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/v1/forge/variant-candidates', {
    schema: {
      operationId: 'listForgeVariantCandidates',
      summary: 'List MVP Agent variant candidates for workbench judgments (G2)',
      tags: ['InnoForge'],
      response: { 200: response },
    },
  }, async () => ({
    candidates: await service.listVariantCandidates(),
  }));

  app.get('/v1/forge/allocation-weights', {
    schema: {
      operationId: 'getForgeAllocationWeights',
      summary: 'Default Credit attribution weights (G4)',
      tags: ['InnoForge'],
      response: { 200: response },
    },
  }, async () => ({
    weights: await service.getAllocationWeights(),
  }));

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/allocations', {
    schema: {
      operationId: 'listForgeAllocations',
      summary: 'List Credit allocations for a settled intent (G4)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        allocations: await service.listAllocations({
          intentId: request.params.intentId,
          tenantId: request.headers['x-tenant-id'],
        }),
        weights: await service.getAllocationWeights(),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Querystring: { intent_id?: string };
  }>('/v1/forge/timeline', {
    schema: {
      operationId: 'getForgeTimeline',
      summary: 'Intent & judgment history timeline (G3) — merge events + judgments',
      tags: ['InnoForge'],
      headers: readHeaders,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { intent_id: id },
      },
      response: { 200: response, 404: errorResponse, 403: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        items: await service.listTimeline({
          tenantId: request.headers['x-tenant-id'],
          ...(request.query.intent_id ? { intentId: request.query.intent_id } : {}),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/judgments', {
    schema: {
      operationId: 'listForgeJudgments',
      summary: 'List responsibility-chain judgments for an intent (G2)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        judgments: await service.listJudgments({
          intentId: request.params.intentId,
          tenantId: request.headers['x-tenant-id'],
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/snapshots', {
    schema: {
      operationId: 'listForgeSnapshots',
      summary: 'List governance snapshots for an intent (G6)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        snapshots: await service.listSnapshots({
          intentId: request.params.intentId,
          tenantId: request.headers['x-tenant-id'],
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/snapshots', {
    schema: {
      operationId: 'createForgeSnapshot',
      summary: 'Create immutable governance snapshot of statement/constraints (G6)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: {
        201: response,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    try {
      return reply.code(201).send(await service.createSnapshot({
        intentId: request.params.intentId,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string; snapshotId: string };
  }>('/v1/forge/intents/:intentId/snapshots/:snapshotId/restore', {
    schema: {
      operationId: 'restoreForgeSnapshot',
      summary: 'Rollback mutable projection to a snapshot (G6); blocked after deploy',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['intentId', 'snapshotId'],
        properties: { intentId: id, snapshotId: id },
      },
      response: {
        200: response,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.restoreSnapshot({
        intentId: request.params.intentId,
        snapshotId: request.params.snapshotId,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string };
    Body: {
      candidate_id: string;
      action: 'ADOPT' | 'REJECT';
      rationale?: string;
      impact?: string;
    };
  }>('/v1/forge/intents/:intentId/judgments', {
    schema: {
      operationId: 'recordForgeJudgment',
      summary: 'Record ADOPT/REJECT judgment on a variant candidate (G2 responsibility chain)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate_id', 'action'],
        properties: {
          candidate_id: id,
          action: { type: 'string', enum: ['ADOPT', 'REJECT'] },
          rationale: { type: 'string', maxLength: 2000 },
          impact: { type: 'string', maxLength: 64 },
        },
      },
      response: {
        201: response,
        200: response,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    try {
      const prior = await service.listJudgments({
        intentId: request.params.intentId,
        tenantId: request.headers['x-tenant-id'],
      });
      const existed = prior.some((item) => item.candidateId === request.body.candidate_id);
      const judgment = await service.recordJudgment({
        intentId: request.params.intentId,
        candidateId: request.body.candidate_id,
        action: request.body.action,
        ...(request.body.rationale !== undefined ? { rationale: request.body.rationale } : {}),
        ...(request.body.impact !== undefined ? { impact: request.body.impact } : {}),
        audit: audit(request),
      });
      return reply.code(existed ? 200 : 201).send(judgment);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{ Headers: Headers; Params: { intentId: string } }>(
    '/v1/forge/intents/:intentId/confirm',
    {
      schema: {
        operationId: 'confirmForgeIntent',
        summary: 'Human confirm before governed physical deploy',
        tags: ['InnoForge'],
        headers,
        params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
        response: { 200: response, 403: errorResponse, 404: errorResponse, 409: errorResponse, 500: errorResponse },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(await service.confirm({ id: request.params.intentId, audit: audit(request) }));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post<{ Headers: Headers; Params: { intentId: string } }>(
    '/v1/forge/intents/:intentId/deploy',
    {
      schema: {
        operationId: 'deployForgeIntent',
        summary: 'Controlled deploy gateway → external adapter job',
        tags: ['InnoForge'],
        headers,
        params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
        response: { 200: response, 403: errorResponse, 404: errorResponse, 409: errorResponse, 500: errorResponse },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(await service.deploy({ id: request.params.intentId, audit: audit(request) }));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post<{ Headers: Headers; Params: { intentId: string } }>(
    '/v1/forge/intents/:intentId/feedback',
    {
      schema: {
        operationId: 'feedbackForgeIntent',
        summary: 'Advance adapter feedback and settle Credit on success',
        tags: ['InnoForge'],
        headers,
        params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
        response: { 200: response, 403: errorResponse, 404: errorResponse, 409: errorResponse, 500: errorResponse },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(await service.feedback({ id: request.params.intentId, audit: audit(request) }));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId', {
    schema: {
      operationId: 'getForgeIntent',
      summary: 'Read forge intent loop state and event trail',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    const intent = await service.get({
      id: request.params.intentId,
      tenantId: request.headers['x-tenant-id'],
    });
    return intent
      ? reply.send(intent)
      : reply.code(404).send({ error: 'INTENT_NOT_FOUND', request_id: request.id });
  });

  app.get<{
    Headers: { 'x-actor-id'?: string; 'x-tenant-id'?: string };
    Params: { room: SseRoomKind };
    Querystring: { 'x-actor-id'?: string; 'x-tenant-id'?: string };
  }>('/v1/forge/sse/:room', {
    schema: {
      operationId: 'subscribeForgeSseRoom',
      summary: 'Subscribe to tenant-scoped negotiate or governance SSE room',
      tags: ['InnoForge'],
      params: { type: 'object', required: ['room'], properties: { room: { type: 'string', enum: ['negotiate', 'governance'] } } },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { 'x-actor-id': id, 'x-tenant-id': id },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] || request.query['x-tenant-id'];
    const actorId = request.headers['x-actor-id'] || request.query['x-actor-id'];
    if (!tenantId || !actorId) {
      return reply.code(400).send({ error: 'TENANT_ACTOR_REQUIRED', request_id: request.id });
    }
    await forgeSseHub.subscribe({
      room: request.params.room,
      tenantId,
      actorId,
      request,
      reply,
    });
  });

  app.post<{
    Headers: Headers;
    Params: { room: SseRoomKind };
    Body: { text: string };
  }>('/v1/forge/sse/:room/messages', {
    schema: {
      operationId: 'postForgeSseMessage',
      summary: 'Publish a message into a tenant-scoped SSE room',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['room'], properties: { room: { type: 'string', enum: ['negotiate', 'governance'] } } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
      },
      response: { 201: response, 409: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.code(201).send(forgeSseHub.publish({
        room: request.params.room,
        tenantId: request.headers['x-tenant-id'],
        actorId: request.headers['x-actor-id'],
        text: request.body.text,
        at: new Date().toISOString(),
      }));
    } catch {
      return reply.code(409).send({ error: 'SSE_TEXT_REQUIRED', request_id: request.id });
    }
  });

  app.get<{ Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'> }>('/v1/forge/partner/config', {
    schema: {
      operationId: 'getPartnerConfig',
      summary: 'Read partner outbound webhook config (sim-first)',
      tags: ['InnoForge'],
      headers: readHeaders,
      response: { 200: response },
    },
  }, async (request) => partnerGateway.getConfig(request.headers['x-tenant-id']));

  app.put<{
    Headers: Headers;
    Body: { outbound_url: string; enabled: boolean };
  }>('/v1/forge/partner/config', {
    schema: {
      operationId: 'putPartnerConfig',
      summary: 'Configure partner outbound URL and enablement',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['outbound_url', 'enabled'],
        properties: {
          outbound_url: { type: 'string', minLength: 1, maxLength: 2000 },
          enabled: { type: 'boolean' },
        },
      },
      response: { 200: response, 409: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send(partnerGateway.setConfig({
        tenantId: request.headers['x-tenant-id'],
        outboundUrl: request.body.outbound_url,
        enabled: request.body.enabled,
      }));
    } catch (error) {
      const code = error instanceof PartnerGatewayError ? error.code : 'INTERNAL_ERROR';
      return reply.code(409).send({ error: code, request_id: request.id });
    }
  });

  app.post<{
    Headers: Headers;
    Body: { kind: string; payload?: Record<string, unknown>; intent_id?: string };
  }>('/v1/forge/partner/outbound', {
    schema: {
      operationId: 'postPartnerOutbound',
      summary: 'Fire outbound partner webhook (default: local CNC receiver)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', minLength: 1, maxLength: 128 },
          payload: { type: 'object', additionalProperties: true },
          intent_id: id,
        },
      },
      response: { 201: response, 409: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    try {
      const event = await partnerGateway.sendOutbound({
        tenantId: request.headers['x-tenant-id'],
        kind: request.body.kind,
        payload: {
          ...(request.body.payload ?? {}),
          ...(request.body.intent_id ? { intentId: request.body.intent_id } : {}),
          actorId: request.headers['x-actor-id'],
        },
      });
      return reply.code(201).send(event);
    } catch (error) {
      const code = error instanceof PartnerGatewayError ? error.code : 'INTERNAL_ERROR';
      return reply.code(code === 'INTERNAL_ERROR' ? 500 : 409).send({ error: code, request_id: request.id });
    }
  });

  app.post<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Body: { kind?: string; payload?: Record<string, unknown> };
  }>('/v1/forge/partner/callbacks', {
    schema: {
      operationId: 'postPartnerCallback',
      summary: 'Inbound partner callback (fabricator → PXN)',
      tags: ['InnoForge'],
      headers: readHeaders,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          payload: { type: 'object', additionalProperties: true },
        },
      },
      response: { 201: response },
    },
  }, async (request, reply) => reply.code(201).send(partnerGateway.receiveCallback({
    tenantId: request.headers['x-tenant-id'],
    kind: request.body.kind ?? 'partner.callback',
    payload: request.body.payload ?? {},
  })));

  app.post<{
    Headers: { 'x-tenant-id'?: string };
    Body: Record<string, unknown>;
  }>('/v1/forge/partner/webhook-receiver', {
    schema: {
      operationId: 'partnerWebhookReceiver',
      summary: 'Local CNC/fab simulator webhook receiver',
      tags: ['InnoForge'],
      body: { type: 'object', additionalProperties: true },
      response: { 200: response },
    },
  }, async (request, reply) => {
    const tenantId = request.headers['x-tenant-id']
      || (typeof request.body.tenantId === 'string' ? request.body.tenantId : 'tenant.demo');
    const ack = partnerGateway.receiveAsSimulator({ tenantId, body: request.body });
    // Also mirror inbound callback so Deploy viz sees the fab progress.
    partnerGateway.receiveCallback({
      tenantId,
      kind: 'fab.progress',
      payload: ack.payload,
    });
    return reply.send({ ok: true, ack });
  });

  app.get<{ Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'> }>('/v1/forge/partner/events', {
    schema: {
      operationId: 'listPartnerEvents',
      summary: 'List recent partner outbound/inbound/receiver events',
      tags: ['InnoForge'],
      headers: readHeaders,
      response: { 200: response },
    },
  }, async (request) => ({
    events: partnerGateway.listEvents(request.headers['x-tenant-id']),
    config: partnerGateway.getConfig(request.headers['x-tenant-id']),
  }));
}
