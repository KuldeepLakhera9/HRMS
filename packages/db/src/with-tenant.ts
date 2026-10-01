import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getAppPool } from './client.js';
import * as schema from './schema/index.js';

export interface TenantContext {
  companyId: string;
  userId?: string;
  employeeId?: string;
  roles?: string[];
  permissions?: string[];
  requestId?: string;
}

export type DrizzleTransaction = NodePgDatabase<typeof schema>;

/**
 * withTenant executes a callback inside a PostgreSQL transaction with tenant isolation.
 *
 * CRITICAL ARCHITECTURE RULE (AGENTS.md Section 4):
 * - Sets `app.company_id` and optionally `app.user_id` using `set_config(..., true)`.
 * - The 3rd parameter `true` enforces `is_local = true`, binding settings strictly to the current transaction.
 * - This guarantees that connections pooled by PgBouncer (in transaction mode) never leak tenant context.
 * - Enforces Row Level Security (RLS) transparently for the `hrms_app` role.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: DrizzleTransaction, client: pg.PoolClient) => Promise<T>,
  poolOverride?: pg.Pool,
): Promise<T> {
  const pool = poolOverride ?? getAppPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Transaction-local tenant context (is_local = true)
    await client.query("SELECT set_config('app.company_id', $1, true)", [ctx.companyId]);

    if (ctx.userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    }

    const tx = drizzle(client, { schema });
    const result = await fn(tx, client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[withTenant Rollback Error]', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
