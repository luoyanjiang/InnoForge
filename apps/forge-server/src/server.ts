import { Pool } from 'pg';

import { buildForgeApp } from './app.js';
import { loadForgeServerConfig } from './config.js';
import { PostgresHealthProbe } from './infrastructure/postgres/health.js';
import { PostgresForgeLoopService } from './modules/innoforge/postgres-forge-loop.js';
import { createPxnBridge } from './modules/innoforge/pxn-bridge.js';

const config = loadForgeServerConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const bridge = createPxnBridge(process.env);
const forgeLoopService = new PostgresForgeLoopService(pool, undefined, bridge);

const app = await buildForgeApp({
  healthProbe: new PostgresHealthProbe(pool),
  forgeLoopService,
  logger: true,
});

app.addHook('onClose', async () => {
  await pool.end();
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal, pxnBaseUrl: config.pxnBaseUrl ?? null }, 'shutting down forge-server');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({
    host: config.host,
    port: config.port,
    pxnBridge: config.pxnBaseUrl ? 'http' : 'simulator',
  }, 'InnoForge forge-server listening');
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
