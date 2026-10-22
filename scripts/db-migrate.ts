import { Pool } from 'pg';

import {
  migrateDown,
  migrateUp,
  migrationStatus,
} from '../apps/forge-server/src/infrastructure/postgres/migrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');

const command = process.argv[2] ?? 'up';
if (!['up', 'down', 'status'].includes(command)) throw new Error(`MIGRATION_COMMAND_INVALID:${command}`);

const pool = new Pool({ connectionString: databaseUrl });
try {
  if (command === 'up') {
    const applied = await migrateUp(pool);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database already current');
  } else if (command === 'down') {
    const rolledBack = await migrateDown(pool);
    console.log(rolledBack.length ? `rolled back: ${rolledBack.join(', ')}` : 'no applied migration');
  } else {
    for (const migration of await migrationStatus(pool)) {
      console.log(`${migration.applied ? 'up' : 'down'} ${migration.version}_${migration.name}`);
    }
  }
} finally {
  await pool.end();
}
