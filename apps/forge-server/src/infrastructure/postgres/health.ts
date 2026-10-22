import type { Pool } from 'pg';

export type HealthResult = Readonly<{
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
}>;

export interface HealthProbe {
  check(): Promise<HealthResult>;
}

export class PostgresHealthProbe implements HealthProbe {
  constructor(private readonly pool: Pool) {}

  async check(): Promise<HealthResult> {
    try {
      await this.pool.query('SELECT 1');
      return Object.freeze({ status: 'ok', database: 'up' });
    } catch {
      return Object.freeze({ status: 'degraded', database: 'down' });
    }
  }
}
