import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getOwnerPool } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(poolOverride?: pg.Pool): Promise<void> {
  const pool = poolOverride ?? getOwnerPool();
  const client = await pool.connect();

  try {
    console.info('[Migration Runner] Checking and applying migrations as hrms_owner...');

    // 1. Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS __hrms_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz DEFAULT now() NOT NULL
      );
    `);

    // 2. Discover migration files
    const migrationsDir = path.resolve(__dirname, '../migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.warn(`[Migration Runner] Directory '${migrationsDir}' does not exist.`);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // 3. Apply pending migrations in order
    for (const file of files) {
      const res = await client.query(
        'SELECT 1 FROM __hrms_migrations WHERE name = $1',
        [file],
      );

      if (res.rowCount === 0) {
        console.info(`[Migration Runner] Applying migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO __hrms_migrations (name) VALUES ($1)',
            [file],
          );
          await client.query('COMMIT');
          console.info(`[Migration Runner] Successfully applied: ${file}`);
        } catch (migrationError) {
          await client.query('ROLLBACK');
          console.error(`[Migration Runner] Failed to apply: ${file}`, migrationError);
          throw migrationError;
        }
      } else {
        // Already applied
      }
    }

    console.info('[Migration Runner] All migrations are up to date.');
  } finally {
    client.release();
  }
}

// Allow direct execution: node dist/migrate.js
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
