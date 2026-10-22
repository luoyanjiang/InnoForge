import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';

import type { HealthProbe } from './infrastructure/postgres/health.js';
import { registerForgeRoutes } from './modules/innoforge/forge-routes.js';
import type { ForgeLoopService } from './modules/innoforge/forge-loop.js';

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'database'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['up', 'down'] },
  },
} as const;

/** Slim Fastify app: health + InnoForge routes + /forge console. */
export async function buildForgeApp(options: {
  healthProbe: HealthProbe;
  forgeLoopService: ForgeLoopService;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: 'x-request-id' });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'InnoForge API',
        description: 'Standalone Intent OS × InnoForge control plane (PXN optional via PXN_BASE_URL).',
        version: '0.1.0',
      },
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get(
    '/healthz',
    {
      schema: {
        operationId: 'getHealth',
        summary: 'Check forge-server and PostgreSQL readiness',
        tags: ['Operations'],
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await options.healthProbe.check();
      return reply.code(result.status === 'ok' ? 200 : 503).send(result);
    },
  );

  registerForgeRoutes(app, options.forgeLoopService);
  return app;
}

/** @deprecated alias — tests historically called buildControlPlaneApp */
export const buildControlPlaneApp = buildForgeApp;
