import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('withTenant Transaction Helper Isolation Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  const mockUserId = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany('Company Tx Test', 'tx-test.internal');
  });

  afterAll(async () => {
    await db.close();
  });

  it('sets app.company_id and app.user_id for duration of transaction', async () => {
    await withTenant({ companyId, userId: mockUserId }, async (_tx, client) => {
      const companyRes = await client.query("SELECT current_setting('app.company_id', true) as val");
      const userRes = await client.query("SELECT current_setting('app.user_id', true) as val");

      expect(companyRes.rows[0]?.val).toBe(companyId);
      expect(userRes.rows[0]?.val).toBe(mockUserId);
    }, db.appPool);
  });

  it('automatically rolls back transaction on error without leaking writes', async () => {
    const rolledBackId = generateUuidV7();

    await expect(
      withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
          [rolledBackId, companyId, 'Should Rollback Item'],
        );
        throw new Error('Simulated failure triggering rollback');
      }, db.appPool),
    ).rejects.toThrow('Simulated failure triggering rollback');

    // Verify row was not persisted
    await withTenant({ companyId }, async (_tx, client) => {
      const res = await client.query(
        'SELECT * FROM sample_tenant_items WHERE id = $1',
        [rolledBackId],
      );
      expect(res.rows.length).toBe(0);
    }, db.appPool);
  });
});
