import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getAppPool } from './client.js';
import * as schema from './schema/index.js';

export interface TenantContext {
  companyId: string;
  userId?: string | undefined;
  employeeId?: string | undefined;
  roles?: string[] | undefined;
  permissions?: string[] | undefined;
  requestId?: string | undefined;
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
  poolOverride?: pg.Pool | undefined,
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

    const clientWithTracking = client as unknown as {
      query: unknown;
      __originalQuery?: typeof client.query;
      _isMockFunction?: boolean;
    };
    const originalQuery = clientWithTracking.__originalQuery ?? client.query.bind(client);
    const isMock = Boolean((client.query as unknown as { _isMockFunction?: boolean })?._isMockFunction);

    if (!isMock && !clientWithTracking.__originalQuery) {
      clientWithTracking.__originalQuery = originalQuery;
      clientWithTracking.query = async (...args: unknown[]) => {
        const start = Date.now();
        try {
          // @ts-expect-error forwarding arguments
          return await originalQuery(...args);
        } finally {
          const duration = Date.now() - start;
          if (duration > 100) {
            const firstArg = args[0];
            const sqlText =
              typeof firstArg === 'string'
                ? firstArg
                : ((firstArg as { text?: string } | undefined)?.text || '');
            console.warn(`[Slow Query] ${duration}ms: ${sqlText.slice(0, 150).replace(/\s+/g, ' ')}`);
          }
        }
      };
    }

    const tx = drizzle(client, { schema });
    const result = await fn(tx, client);

    await originalQuery('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[withTenant Rollback Error]', rollbackError);
    }
    throw error;
  } finally {
    const clientWithTracking = client as unknown as {
      query?: unknown;
      __originalQuery?: typeof client.query;
    };
    if (clientWithTracking.__originalQuery) {
      clientWithTracking.query = clientWithTracking.__originalQuery;
      delete clientWithTracking.__originalQuery;
    }
    client.release();
  }
}
