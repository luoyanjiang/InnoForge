import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Pool, PoolClient } from 'pg';

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

export type Migration = Readonly<{
  version: string;
  name: string;
  upSql: string;
  downSql: string;
}>;

export type MigrationStatus = Readonly<{
  version: string;
  name: string;
  applied: boolean;
}>;

export class MigrationError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'MigrationError';
  }
}

type MigrationPair = { name: string; upPath?: string; downPath?: string };

export async function loadMigrations(directory = resolve(process.cwd(), 'db/migrations')): Promise<readonly Migration[]> {
  const files = (await readdir(directory)).sort();
  const pairs = new Map<string, MigrationPair>();

  for (const file of files) {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError('MIGRATION_FILENAME_INVALID', file);
    const [, version, name, direction] = match;
    if (!version || !name || !direction) throw new MigrationError('MIGRATION_FILENAME_INVALID', file);
    const current = pairs.get(version) ?? { name };
    if (current.name !== name) throw new MigrationError('MIGRATION_VERSION_COLLISION', version);
    const path = resolve(directory, file);
    if (direction === 'up') {
      if (current.upPath) throw new MigrationError('MIGRATION_DIRECTION_DUPLICATE', file);
      current.upPath = path;
    } else {
      if (current.downPath) throw new MigrationError('MIGRATION_DIRECTION_DUPLICATE', file);
      current.downPath = path;
    }
    pairs.set(version, current);
  }

  const migrations: Migration[] = [];
  for (const [version, pair] of [...pairs].sort(([left], [right]) => left.localeCompare(right))) {
    if (!pair.upPath || !pair.downPath) throw new MigrationError('MIGRATION_PAIR_INCOMPLETE', version);
    migrations.push(
      Object.freeze({
        version,
        name: pair.name,
        upSql: await readFile(pair.upPath, 'utf8'),
        downSql: await readFile(pair.downPath, 'utf8'),
      }),
    );
  }
  return Object.freeze(migrations);
}

async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureMigrationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(pool: Pool): Promise<ReadonlySet<string>> {
  await ensureMigrationTable(pool);
  const result = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map(row => row.version));
}

export async function migrationStatus(pool: Pool): Promise<readonly MigrationStatus[]> {
  const [migrations, applied] = await Promise.all([loadMigrations(), appliedVersions(pool)]);
  return Object.freeze(
    migrations.map(migration =>
      Object.freeze({ version: migration.version, name: migration.name, applied: applied.has(migration.version) }),
    ),
  );
}

export async function migrateUp(pool: Pool): Promise<readonly string[]> {
  const migrations = await loadMigrations();
  const applied = await appliedVersions(pool);
  const completed: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await withTransaction(pool, async client => {
      await client.query(migration.upSql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
    });
    completed.push(migration.version);
  }
  return Object.freeze(completed);
}

export async function migrateDown(pool: Pool, options: { all?: boolean } = {}): Promise<readonly string[]> {
  const migrations = await loadMigrations();
  const applied = await appliedVersions(pool);
  const pending = [...migrations].reverse().filter(migration => applied.has(migration.version));
  const selected = options.all ? pending : pending.slice(0, 1);
  const completed: string[] = [];

  for (const migration of selected) {
    await withTransaction(pool, async client => {
      await client.query(migration.downSql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
    });
    completed.push(migration.version);
  }
  return Object.freeze(completed);
}
