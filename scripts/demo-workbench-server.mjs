#!/usr/bin/env node
/** Ephemeral in-memory forge-server for local demo / screenshots (no Postgres). */
import { buildForgeApp } from '../apps/forge-server/src/app.ts';
import { InMemoryForgeLoopService } from '../apps/forge-server/src/modules/innoforge/forge-loop.ts';

const port = Number(process.env.PORT || 3080);
const service = new InMemoryForgeLoopService();
const app = await buildForgeApp({
  healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'memory' }) },
  forgeLoopService: service,
  logger: true,
});
await app.listen({ host: '127.0.0.1', port });
console.log(`demo workbench listening http://127.0.0.1:${port}/forge`);
