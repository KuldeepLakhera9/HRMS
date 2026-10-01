import pg from 'pg';
import { runMigrations } from '@hrms/db';
import { getEnv } from '@hrms/config';

const { Pool } = pg;

export interface TestDatabaseContext {
  ownerPool: pg.Pool;
  appPool: pg.Pool;
  close: () => Promise<void>;
  createCompany: (name: string, domain: string) => Promise<string>;
}

/**
 * Test helper initializing database schema as hrms_owner and providing
 * pools for hrms_owner (migrations) and hrms_app (DML with RLS).
 */
export async function setupTestDatabase(): Promise<TestDatabaseContext> {
  const env = getEnv();

  const ownerPool = new Pool({
    connectionString: env.DATABASE_OWNER_URL,
    max: 5,
  });

  const appPool = new Pool({
    connectionString: env.DATABASE_APP_URL,
    max: 10,
  });

  // 1. Run all migrations as hrms_owner
  await runMigrations(ownerPool);

  const createCompany = async (name: string, domain: string): Promise<string> => {
    const res = await ownerPool.query(
      `INSERT INTO companies (name, legal_name, domain)
       VALUES ($1, $1, $2)
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
       RETURNING id;`,
      [name, domain],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create company fixture');
    return row.id as string;
  };

  const close = async () => {
    await appPool.end();
    await ownerPool.end();
  };

  return {
    ownerPool,
    appPool,
    createCompany,
    close,
  };
}
