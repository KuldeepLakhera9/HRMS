import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('PostgreSQL Row Level Security (RLS) Proof Tests', () => {
  let db: TestDatabaseContext;
  let companyAId: string;
  let companyBId: string;
  let itemAId: string;
  let itemBId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyAId = await db.createCompany('Company Alpha', 'alpha.internal');
    companyBId = await db.createCompany('Company Beta', 'beta.internal');

    // Seed item for Company A using withTenant
    itemAId = generateUuidV7();
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
        [itemAId, companyAId, 'Alpha Item 1'],
      );
    }, db.appPool);

    // Seed item for Company B using withTenant
    itemBId = generateUuidV7();
    await withTenant({ companyId: companyBId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
        [itemBId, companyBId, 'Beta Item 1'],
      );
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  it('PROOF 1: Query without tenant context returns ZERO rows (app role has no BYPASSRLS)', async () => {
    // Connect directly as hrms_app without setting app.company_id
    const client = await db.appPool.connect();
    try {
      const res = await client.query('SELECT * FROM sample_tenant_items;');
      expect(res.rows.length).toBe(0);

      // Even attempting to query specifically by known ID returns 0 rows
      const specificRes = await client.query(
        'SELECT * FROM sample_tenant_items WHERE id = $1;',
        [itemAId],
      );
      expect(specificRes.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it('PROOF 2: Company A can read its own data but CANNOT read Company B data', async () => {
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      // 1. List all items visible to Company A
      const res = await client.query('SELECT * FROM sample_tenant_items;');
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows.every(row => row.company_id === companyAId)).toBe(true);
      expect(res.rows.some(row => row.id === itemAId)).toBe(true);

      // 2. Querying Company B's item by ID returns 0 rows
      const targetB = await client.query(
        'SELECT * FROM sample_tenant_items WHERE id = $1;',
        [itemBId],
      );
      expect(targetB.rows.length).toBe(0);
    }, db.appPool);
  });

  it('PROOF 3: Company B can read its own data but CANNOT read Company A data', async () => {
    await withTenant({ companyId: companyBId }, async (_tx, client) => {
      const res = await client.query('SELECT * FROM sample_tenant_items;');
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows.every(row => row.company_id === companyBId)).toBe(true);
      expect(res.rows.some(row => row.id === itemBId)).toBe(true);

      const targetA = await client.query(
        'SELECT * FROM sample_tenant_items WHERE id = $1;',
        [itemAId],
      );
      expect(targetA.rows.length).toBe(0);
    }, db.appPool);
  });

  it('PROOF 4: Cross-tenant insert is rejected by RLS WITH CHECK policy', async () => {
    // Connected with Company A context, but attempting to insert a record with company_id = Company B
    await expect(
      withTenant({ companyId: companyAId }, async (_tx, client) => {
        const rogueId = generateUuidV7();
        await client.query(
          `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
          [rogueId, companyBId, 'Rogue cross-tenant item'],
        );
      }, db.appPool),
    ).rejects.toThrow(/new row violates row-level security policy/);
  });
});
