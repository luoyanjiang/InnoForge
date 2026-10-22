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
      && /^(APPROVER_|TASK_|REQUESTER_|ACTIVE_|REVISION_|PXN_|WORKBENCH_)/.test((error as { code: string }).code))
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
  app.get('/forge/workbench.js', async (_request, reply) => {
    const js = readFileSync(join(consoleRoot(), 'workbench.js'), 'utf8');
    return reply.type('application/javascript; charset=utf-8').send(js);
  });
  app.get('/forge/workbench.css', async (_request, reply) => {
    const css = readFileSync(join(consoleRoot(), 'workbench.css'), 'utf8');
    return reply.type('text/css; charset=utf-8').send(css);
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
      scenario?: 'PRODUCT' | 'RESEARCH' | 'HARDWARE';
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
          scenario: { type: 'string', enum: ['PRODUCT', 'RESEARCH', 'HARDWARE'] },
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
        ...(request.body.scenario !== undefined ? { scenario: request.body.scenario } : {}),
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
      scenario?: 'PRODUCT' | 'RESEARCH' | 'HARDWARE';
      collab_stage?: 'DRAFT' | 'EXPLORING' | 'VALIDATING' | 'COMMITTED';
    };
  }>('/v1/forge/intents/:intentId', {
    schema: {
      operationId: 'updateForgeIntent',
      summary: 'Edit statement/constraints, freeze, scenario, or collab stage (G1/V1)',
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
          scenario: { type: 'string', enum: ['PRODUCT', 'RESEARCH', 'HARDWARE'] },
          collab_stage: {
            type: 'string',
            enum: ['DRAFT', 'EXPLORING', 'VALIDATING', 'COMMITTED'],
          },
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
        ...(request.body.scenario !== undefined ? { scenario: request.body.scenario } : {}),
        ...(request.body.collab_stage !== undefined ? { collabStage: request.body.collab_stage } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/tree', {
    schema: {
      operationId: 'getForgeIntentTree',
      summary: 'Get intent tree (V1)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        tree: await service.getIntentTree({
          intentId: request.params.intentId,
          tenantId: request.headers['x-tenant-id'],
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.put<{
    Headers: Headers;
    Params: { intentId: string };
    Body: { nodes: unknown[]; updatedAt?: string };
  }>('/v1/forge/intents/:intentId/tree', {
    schema: {
      operationId: 'replaceForgeIntentTree',
      summary: 'Replace intent tree document (V1)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: true,
        required: ['nodes'],
        properties: {
          nodes: { type: 'array', maxItems: 200 },
          updatedAt: { type: 'string' },
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
      return reply.send({
        tree: await service.replaceIntentTree({
          intentId: request.params.intentId,
          tree: request.body,
          audit: audit(request),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string };
    Body: { parent_id?: string | null; kind: string; title: string };
  }>('/v1/forge/intents/:intentId/tree/nodes', {
    schema: {
      operationId: 'addForgeTreeNode',
      summary: 'Add a node to the intent tree (V1)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title'],
        properties: {
          parent_id: { type: ['string', 'null'], maxLength: 512 },
          kind: { type: 'string', enum: ['GOAL', 'CONSTRAINT', 'SUCCESS', 'BRANCH'] },
          title: { type: 'string', minLength: 1, maxLength: 500 },
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
      return reply.code(201).send({
        tree: await service.addTreeNode({
          intentId: request.params.intentId,
          ...(request.body.parent_id !== undefined ? { parentId: request.body.parent_id } : {}),
          kind: request.body.kind,
          title: request.body.title,
          audit: audit(request),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch<{
    Headers: Headers;
    Params: { intentId: string; nodeId: string };
    Body: { title?: string; status?: string };
  }>('/v1/forge/intents/:intentId/tree/nodes/:nodeId', {
    schema: {
      operationId: 'updateForgeTreeNode',
      summary: 'Update intent tree node title/status (V1)',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['intentId', 'nodeId'],
        properties: { intentId: id, nodeId: id },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          status: { type: 'string', enum: ['OPEN', 'ALIGNED', 'CONFLICT', 'DONE'] },
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
      return reply.send({
        tree: await service.updateTreeNode({
          intentId: request.params.intentId,
          nodeId: request.params.nodeId,
          ...(request.body.title !== undefined ? { title: request.body.title } : {}),
          ...(request.body.status !== undefined ? { status: request.body.status } : {}),
          audit: audit(request),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/tasks', {
    schema: {
      operationId: 'listForgeTasks',
      summary: 'List create-flow tasks bound to an intent (F1)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        tasks: await service.listTasks({
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
    Body: { title: string; executor?: string; tree_node_id?: string | null };
  }>('/v1/forge/intents/:intentId/tasks', {
    schema: {
      operationId: 'createForgeTask',
      summary: 'Create a create-flow task (F1)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 240 },
          executor: { type: 'string', enum: ['AI', 'HUMAN'] },
          tree_node_id: { type: ['string', 'null'], maxLength: 512 },
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
      return reply.code(201).send(await service.createTask({
        intentId: request.params.intentId,
        title: request.body.title,
        ...(request.body.executor !== undefined ? { executor: request.body.executor } : {}),
        ...(request.body.tree_node_id !== undefined
          ? { treeNodeId: request.body.tree_node_id }
          : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch<{
    Headers: Headers;
    Params: { intentId: string; taskId: string };
    Body: { status?: string; executor?: string };
  }>('/v1/forge/intents/:intentId/tasks/:taskId', {
    schema: {
      operationId: 'updateForgeTask',
      summary: 'Advance task status or change executor (F1)',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['intentId', 'taskId'],
        properties: { intentId: id, taskId: id },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            enum: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'FAILED'],
          },
          executor: { type: 'string', enum: ['AI', 'HUMAN'] },
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
      return reply.send(await service.updateTask({
        intentId: request.params.intentId,
        taskId: request.params.taskId,
        ...(request.body.status !== undefined ? { status: request.body.status } : {}),
        ...(request.body.executor !== undefined ? { executor: request.body.executor } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Querystring: { locale?: string };
  }>('/v1/forge/spaces', {
    schema: {
      operationId: 'getForgeSpaces',
      summary: 'Sim personal/team/project asset spaces (F1 — no object store)',
      tags: ['InnoForge'],
      headers: readHeaders,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { locale: { type: 'string', enum: ['zh', 'en'] } },
      },
      response: { 200: response },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.getSpaces({
        tenantId: request.headers['x-tenant-id'],
        ...(request.query.locale !== undefined ? { locale: request.query.locale } : {}),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  const wbParams = {
    type: 'object',
    required: ['intentId'],
    properties: { intentId: id },
  } as const;

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Querystring: { locale?: string };
  }>('/v1/forge/projects', {
    schema: {
      operationId: 'listForgeProjects',
      summary: 'List projects (intents as Project containers)',
      tags: ['InnoForge'],
      headers: readHeaders,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { locale: { type: 'string', enum: ['zh', 'en'] } },
      },
      response: { 200: response },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        projects: await service.listProjects({
          tenantId: request.headers['x-tenant-id'],
          ...(request.query.locale === 'zh' || request.query.locale === 'en'
            ? { locale: request.query.locale }
            : {}),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Body: { lang?: 'zh' | 'en' };
  }>('/v1/forge/projects/ensure-demo', {
    schema: {
      operationId: 'ensureForgeDemoProjects',
      summary: 'Ensure demo projects (Lightboat + Hoshino)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { lang: { type: 'string', enum: ['zh', 'en'] } },
      },
      response: { 200: response, 403: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        projects: await service.ensureDemoProjects({
          audit: audit(request),
          ...(request.body.lang !== undefined ? { locale: request.body.lang } : {}),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Querystring: { locale?: string };
  }>('/v1/forge/my-tasks', {
    schema: {
      operationId: 'listForgeMyTasks',
      summary: 'Cross-project task view (not a task space)',
      tags: ['InnoForge'],
      headers: readHeaders,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { locale: { type: 'string', enum: ['zh', 'en'] } },
      },
      response: { 200: response },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        tasks: await service.listMyTasks({
          tenantId: request.headers['x-tenant-id'],
          actorId: request.headers['x-actor-id'],
          ...(request.query.locale === 'zh' || request.query.locale === 'en'
            ? { locale: request.query.locale }
            : {}),
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Body: { intent_id?: string; lang?: 'zh' | 'en' };
  }>('/v1/forge/workbench/ensure', {
    schema: {
      operationId: 'ensureForgeWorkbench',
      summary: 'Ensure demo studio project + workbench state (v0.5 P0)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent_id: id,
          lang: { type: 'string', enum: ['zh', 'en'] },
        },
      },
      response: { 200: response, 403: errorResponse, 409: errorResponse, 500: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.ensureWorkbench({
        ...(request.body.intent_id !== undefined ? { intentId: request.body.intent_id } : {}),
        ...(request.body.lang !== undefined ? { lang: request.body.lang } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/workbench', {
    schema: {
      operationId: 'getForgeWorkbench',
      summary: 'Get validation workbench state (seeds demo if missing)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: wbParams,
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.getWorkbench({
        intentId: request.params.intentId,
        tenantId: request.headers['x-tenant-id'],
        audit: {
          actorId: request.headers['x-actor-id'],
          idempotencyKey: `wb-get:${request.id}`,
          requestId: request.id,
          occurredAt: new Date().toISOString(),
          tenantId: request.headers['x-tenant-id'],
        },
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch<{
    Headers: Headers;
    Params: { intentId: string };
    Body: Record<string, unknown>;
  }>('/v1/forge/intents/:intentId/workbench', {
    schema: {
      operationId: 'patchForgeWorkbench',
      summary: 'Patch workbench UI fields (req/pages/days/role/lang/stage/panel)',
      tags: ['InnoForge'],
      headers,
      params: wbParams,
      body: { type: 'object', additionalProperties: true },
      response: { 200: response, 404: errorResponse, 409: errorResponse },
    },
  }, async (request, reply) => {
    try {
      return reply.send(await service.patchWorkbench({
        intentId: request.params.intentId,
        patch: request.body,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  const wbWrite = (
    path: string,
    operationId: string,
    summary: string,
    handler: (
      intentId: string,
      body: Record<string, unknown>,
      a: ReturnType<typeof audit>,
    ) => Promise<unknown>,
    bodySchema: Record<string, unknown> = { type: 'object', additionalProperties: false },
  ) => {
    app.post<{
      Headers: Headers;
      Params: { intentId: string };
      Body: Record<string, unknown>;
    }>(path, {
      schema: {
        operationId,
        summary,
        tags: ['InnoForge'],
        headers,
        params: wbParams,
        body: bodySchema,
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
        return reply.send(await handler(
          request.params.intentId,
          request.body ?? {},
          audit(request),
        ));
      } catch (error) {
        return fail(request, reply, error);
      }
    });
  };

  wbWrite(
    '/v1/forge/intents/:intentId/workbench/accept',
    'acceptForgeWorkbench',
    'Accept contract: freeze R1 + create T-01 task',
    (intentId, _body, a) => service.acceptWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/build',
    'buildForgeWorkbench',
    'Simulate craft build (SIM reserve→spend)',
    (intentId, body, a) => service.buildWorkbench({
      intentId,
      ...(typeof body.action === 'string'
        ? { action: body.action as 'start' | 'tick' | 'complete' | 'pause' | 'run' }
        : {}),
      audit: a,
    }),
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['start', 'tick', 'complete', 'pause', 'run'] },
      },
    },
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/run-checks',
    'runForgeWorkbenchChecks',
    'Run three acceptance cases (checks ≠ accept)',
    (intentId, _body, a) => service.runWorkbenchChecks({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/feedback',
    'feedbackForgeWorkbench',
    'Client feedback on rush fee / delivery',
    (intentId, body, a) => service.feedbackWorkbench({
      intentId,
      text: String(body.text ?? ''),
      audit: a,
    }),
    {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 280 } },
    },
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/reply',
    'replyForgeWorkbench',
    'Maker reply to open feedback',
    (intentId, body, a) => service.replyWorkbench({
      intentId,
      response: String(body.response ?? ''),
      audit: a,
    }),
    {
      type: 'object',
      additionalProperties: false,
      required: ['response'],
      properties: { response: { type: 'string', minLength: 1, maxLength: 280 } },
    },
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/rules',
    'rulesForgeWorkbench',
    'Save pricing rules → version++',
    (intentId, body, a) => service.rulesWorkbench({
      intentId,
      rule: {
        price: Number(body.price),
        threshold: Number(body.threshold),
        rate: Number(body.rate),
      },
      audit: a,
    }),
    {
      type: 'object',
      additionalProperties: false,
      required: ['price', 'threshold', 'rate'],
      properties: {
        price: { type: 'integer', minimum: 100, maximum: 10000 },
        threshold: { type: 'integer', minimum: 1, maximum: 50 },
        rate: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/resolve-feedback',
    'resolveForgeWorkbenchFeedback',
    'Client confirms feedback resolved',
    (intentId, _body, a) => service.resolveFeedbackWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/submit',
    'submitForgeWorkbench',
    'Submit delivery for client acceptance',
    (intentId, _body, a) => service.submitWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/withdraw',
    'withdrawForgeWorkbench',
    'Withdraw pending submission',
    (intentId, _body, a) => service.withdrawWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/return',
    'returnForgeWorkbench',
    'Client returns delivery for revision',
    (intentId, body, a) => service.returnWorkbench({
      intentId,
      ...(typeof body.text === 'string' ? { text: body.text } : {}),
      audit: a,
    }),
    {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', maxLength: 280 } },
    },
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/accept-delivery',
    'acceptForgeWorkbenchDelivery',
    'Accept delivery → payable PAYABLE (unpaid)',
    (intentId, _body, a) => service.acceptDeliveryWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/register-asset',
    'registerForgeWorkbenchAsset',
    'Register quote tool as team asset metadata',
    (intentId, _body, a) => service.registerAssetWorkbench({ intentId, audit: a }),
  );
  wbWrite(
    '/v1/forge/intents/:intentId/workbench/reset',
    'resetForgeWorkbench',
    'Reset demo workbench only',
    (intentId, _body, a) => service.resetWorkbench({ intentId, audit: a }),
  );

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
  }>('/v1/forge/intents/:intentId/workbench/delivery.zip', {
    schema: {
      operationId: 'downloadForgeWorkbenchDelivery',
      summary: 'Download delivery ZIP (html + json + readme)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: wbParams,
      response: { 200: { type: 'string', format: 'binary' }, 404: errorResponse, 409: errorResponse },
    },
  }, async (request, reply) => {
    try {
      const zip = await service.deliveryZipWorkbench({
        intentId: request.params.intentId,
        tenantId: request.headers['x-tenant-id'],
      });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${zip.filename}"`)
        .send(zip.buffer);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/v1/forge/scenario-modes', {
    schema: {
      operationId: 'listForgeScenarioModes',
      summary: 'List Product/Research/Hardware scenario modes (V1)',
      tags: ['InnoForge'],
      response: { 200: response },
    },
  }, async () => ({
    scenarios: ['PRODUCT', 'RESEARCH', 'HARDWARE'],
    collabStages: ['DRAFT', 'EXPLORING', 'VALIDATING', 'COMMITTED'],
  }));

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

  app.get<{ Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'> }>('/v1/forge/lifeforms', {
    schema: {
      operationId: 'listForgeLifeforms',
      summary: 'List lifeforms for tenant (G7 lifecycle)',
      tags: ['InnoForge'],
      headers: readHeaders,
      response: { 200: response },
    },
  }, async (request, reply) => {
    try {
      return reply.send({
        lifeforms: await service.listLifeforms({
          tenantId: request.headers['x-tenant-id'],
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { lifeformId: string };
  }>('/v1/forge/lifeforms/:lifeformId', {
    schema: {
      operationId: 'getForgeLifeform',
      summary: 'Get one lifeform by id (G7)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['lifeformId'], properties: { lifeformId: id } },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      const lifeform = await service.getLifeform({
        id: request.params.lifeformId,
        tenantId: request.headers['x-tenant-id'],
      });
      if (!lifeform) return fail(request, reply, new ForgeLoopError('LIFEFORM_NOT_FOUND'));
      return reply.send(lifeform);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Body: { intent_id: string; name?: string };
  }>('/v1/forge/lifeforms', {
    schema: {
      operationId: 'createForgeLifeform',
      summary: 'Promote SETTLED intent to lifeform (G7)',
      tags: ['InnoForge'],
      headers,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['intent_id'],
        properties: {
          intent_id: id,
          name: { type: 'string', maxLength: 128 },
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
      return reply.code(201).send(await service.createLifeform({
        intentId: request.body.intent_id,
        ...(request.body.name !== undefined ? { name: request.body.name } : {}),
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { lifeformId: string };
    Body: { summary: string };
  }>('/v1/forge/lifeforms/:lifeformId/proposals', {
    schema: {
      operationId: 'addForgeLifeformProposal',
      summary: 'Add evolution proposal to ACTIVE lifeform (G7)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['lifeformId'], properties: { lifeformId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string', minLength: 1, maxLength: 500 } },
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
      return reply.code(201).send(await service.addLifeformProposal({
        lifeformId: request.params.lifeformId,
        summary: request.body.summary,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { lifeformId: string; proposalId: string };
    Body: { decision: 'ACCEPTED' | 'REJECTED' };
  }>('/v1/forge/lifeforms/:lifeformId/proposals/:proposalId/decide', {
    schema: {
      operationId: 'decideForgeLifeformProposal',
      summary: 'Accept or reject a pending evolution proposal (G7)',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['lifeformId', 'proposalId'],
        properties: { lifeformId: id, proposalId: id },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['decision'],
        properties: { decision: { type: 'string', enum: ['ACCEPTED', 'REJECTED'] } },
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
      return reply.send(await service.decideLifeformProposal({
        lifeformId: request.params.lifeformId,
        proposalId: request.params.proposalId,
        decision: request.body.decision,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { lifeformId: string };
    Body: { status: 'ACTIVE' | 'FROZEN' | 'TERMINATED' };
  }>('/v1/forge/lifeforms/:lifeformId/status', {
    schema: {
      operationId: 'setForgeLifeformStatus',
      summary: 'Freeze, unfreeze, or terminate a lifeform (G7)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['lifeformId'], properties: { lifeformId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'FROZEN', 'TERMINATED'] },
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
      return reply.send(await service.setLifeformStatus({
        lifeformId: request.params.lifeformId,
        status: request.body.status,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string };
    Querystring: { includeForgotten?: string };
  }>('/v1/forge/intents/:intentId/memories', {
    schema: {
      operationId: 'listForgeMemories',
      summary: 'List Lumen memories for an intent (G8)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { includeForgotten: { type: 'string', enum: ['1', 'true', '0', 'false'] } },
      },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      const include = request.query.includeForgotten === '1'
        || request.query.includeForgotten === 'true';
      return reply.send({
        memories: await service.listMemories({
          intentId: request.params.intentId,
          tenantId: request.headers['x-tenant-id'],
          includeForgotten: include,
        }),
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get<{
    Headers: Pick<Headers, 'x-actor-id' | 'x-tenant-id'>;
    Params: { intentId: string; memoryId: string };
  }>('/v1/forge/intents/:intentId/memories/:memoryId', {
    schema: {
      operationId: 'getForgeMemory',
      summary: 'Get one Lumen memory (G8)',
      tags: ['InnoForge'],
      headers: readHeaders,
      params: {
        type: 'object',
        required: ['intentId', 'memoryId'],
        properties: { intentId: id, memoryId: id },
      },
      response: { 200: response, 404: errorResponse },
    },
  }, async (request, reply) => {
    try {
      const memory = await service.getMemory({
        intentId: request.params.intentId,
        memoryId: request.params.memoryId,
        tenantId: request.headers['x-tenant-id'],
      });
      if (!memory) return fail(request, reply, new ForgeLoopError('MEMORY_NOT_FOUND'));
      return reply.send(memory);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string };
    Body: { text: string };
  }>('/v1/forge/intents/:intentId/memories', {
    schema: {
      operationId: 'createForgeMemory',
      summary: 'Create a Lumen memory for an intent (G8)',
      tags: ['InnoForge'],
      headers,
      params: { type: 'object', required: ['intentId'], properties: { intentId: id } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
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
      return reply.code(201).send(await service.createMemory({
        intentId: request.params.intentId,
        text: request.body.text,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.delete<{
    Headers: Headers;
    Params: { intentId: string; memoryId: string };
  }>('/v1/forge/intents/:intentId/memories/:memoryId', {
    schema: {
      operationId: 'forgetForgeMemory',
      summary: 'Forget (soft-delete) a Lumen memory (G8)',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['intentId', 'memoryId'],
        properties: { intentId: id, memoryId: id },
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
      return reply.send(await service.forgetMemory({
        intentId: request.params.intentId,
        memoryId: request.params.memoryId,
        audit: audit(request),
      }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post<{
    Headers: Headers;
    Params: { intentId: string; memoryId: string };
  }>('/v1/forge/intents/:intentId/memories/:memoryId/promote', {
    schema: {
      operationId: 'promoteForgeMemory',
      summary: 'Promote memory to consensus constraint + event (G8)',
      tags: ['InnoForge'],
      headers,
      params: {
        type: 'object',
        required: ['intentId', 'memoryId'],
        properties: { intentId: id, memoryId: id },
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
      return reply.send(await service.promoteMemory({
        intentId: request.params.intentId,
        memoryId: request.params.memoryId,
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
