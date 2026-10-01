import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getEnv } from '@hrms/config';
import * as schema from './schema/index.js';

const { Pool } = pg;

// Global symbols to maintain singletons across Hot Module Replacement (HMR)
declare global {
  var __hrms_app_pool__: pg.Pool | undefined;
  var __hrms_owner_pool__: pg.Pool | undefined;
  var __hrms_drizzle_app_db__: NodePgDatabase<typeof schema> | undefined;
}

export function getAppPool(): pg.Pool {
  if (!globalThis.__hrms_app_pool__) {
    const env = getEnv();
    const connectionString = env.DATABASE_APP_URL || env.DATABASE_URL;
    globalThis.__hrms_app_pool__ = new Pool({
      connectionString,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    globalThis.__hrms_app_pool__.on('error', (err: Error) => {
      // Prevent unhandled errors from terminating process on idle client drop
      console.error('[PostgreSQL App Pool Error]', err);
    });
  }
  return globalThis.__hrms_app_pool__;
}

export function getOwnerPool(): pg.Pool {
  if (!globalThis.__hrms_owner_pool__) {
    const env = getEnv();
    globalThis.__hrms_owner_pool__ = new Pool({
      connectionString: env.DATABASE_OWNER_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    globalThis.__hrms_owner_pool__.on('error', (err: Error) => {
      console.error('[PostgreSQL Owner Pool Error]', err);
    });
  }
  return globalThis.__hrms_owner_pool__;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalThis.__hrms_drizzle_app_db__) {
    const pool = getAppPool();
    globalThis.__hrms_drizzle_app_db__ = drizzle(pool, { schema });
  }
  return globalThis.__hrms_drizzle_app_db__;
}

export async function closePools(): Promise<void> {
  if (globalThis.__hrms_app_pool__) {
    await globalThis.__hrms_app_pool__.end();
    globalThis.__hrms_app_pool__ = undefined;
  }
  if (globalThis.__hrms_owner_pool__) {
    await globalThis.__hrms_owner_pool__.end();
    globalThis.__hrms_owner_pool__ = undefined;
  }
  globalThis.__hrms_drizzle_app_db__ = undefined;
}
