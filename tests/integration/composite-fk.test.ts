import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('Composite Foreign Key Cross-Tenant Proof Tests', () => {
  let db: TestDatabaseContext;
  let companyAId: string;
  let companyBId: string;
  let parentItemAId: string;
  let parentItemBId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyAId = await db.createCompany('Company FK Alpha', 'fk-alpha.internal');
    companyBId = await db.createCompany('Company FK Beta', 'fk-beta.internal');

    parentItemAId = generateUuidV7();
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
        [parentItemAId, companyAId, 'Parent Alpha'],
      );
    }, db.appPool);

    parentItemBId = generateUuidV7();
    await withTenant({ companyId: companyBId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO sample_tenant_items (id, company_id, name) VALUES ($1, $2, $3)`,
        [parentItemBId, companyBId, 'Parent Beta'],
      );
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  it('allows child insert when composite foreign key (company_id, parent_id) matches', async () => {
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      const childId = generateUuidV7();
      const res = await client.query(
        `INSERT INTO sample_tenant_subitems (id, company_id, parent_id, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name;`,
        [childId, companyAId, parentItemAId, 'Valid Child Alpha'],
      );
      expect(res.rows[0]?.id).toBe(childId);
    }, db.appPool);
  });

  it('PROOF: Cross-tenant foreign key reference fails at database constraint level', async () => {
    // Inside Company B context, attempt to link child item to Company A's parent item
    await expect(
      withTenant({ companyId: companyBId }, async (_tx, client) => {
        const rogueChildId = generateUuidV7();
        await client.query(
          `INSERT INTO sample_tenant_subitems (id, company_id, parent_id, name)
           VALUES ($1, $2, $3, $4)`,
          [rogueChildId, companyBId, parentItemAId, 'Cross-Tenant Rogue Child'],
        );
      }, db.appPool),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});
