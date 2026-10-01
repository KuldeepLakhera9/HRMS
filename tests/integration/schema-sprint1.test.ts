import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('Sprint 1.1 Core Schema & RLS Verification', () => {
  let db: TestDatabaseContext;

  beforeAll(async () => {
    db = await setupTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('proves zero rows returned without tenant context on new tenant tables', async () => {
    const domain = `zerorows-${generateUuidV7()}.internal`;
    const companyId = await db.createCompany('Schema Zero Rows Co', domain);
    const testEmail = `zerorow_${generateUuidV7()}@test.com`;

    // Insert user inside tenant context
    const testUserId = generateUuidV7();
    await withTenant({ companyId, userId: testUserId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [testUserId, companyId, testEmail, 'dummy_hash'],
      );
    }, db.appPool);

    // Query outside tenant context as hrms_app
    const rawResult = await db.appPool.query('SELECT * FROM users WHERE email = $1', [testEmail]);
    expect(rawResult.rows).toHaveLength(0);
  });

  it('proves cross-tenant isolation on users and departments', async () => {
    const companyAId = await db.createCompany('Company A Sprint 1', `companya-${generateUuidV7()}.internal`);
    const companyBId = await db.createCompany('Company B Sprint 1', `companyb-${generateUuidV7()}.internal`);

    const userAId = generateUuidV7();
    const deptAId = generateUuidV7();
    const emailA = `usera_${generateUuidV7()}@companya.com`;
    const deptCodeA = `ENG_${generateUuidV7().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    // Seed Company A records
    await withTenant({ companyId: companyAId, userId: userAId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [userAId, companyAId, emailA, 'pwd_hash'],
      );
      await client.query(
        `INSERT INTO departments (id, company_id, name, code)
         VALUES ($1, $2, $3, $4)`,
        [deptAId, companyAId, 'Engineering', deptCodeA],
      );
    }, db.appPool);

    // Company B must see 0 rows of Company A
    await withTenant({ companyId: companyBId, userId: generateUuidV7() }, async (_tx, client) => {
      const userRes = await client.query('SELECT * FROM users WHERE email = $1', [emailA]);
      expect(userRes.rows).toHaveLength(0);

      const deptRes = await client.query('SELECT * FROM departments WHERE code = $1', [deptCodeA]);
      expect(deptRes.rows).toHaveLength(0);
    }, db.appPool);
  });

  it('proves partitioned audit_logs receives inserts and blocks UPDATE/DELETE', async () => {
    const companyId = await db.createCompany('Audit Partition Co', 'auditpart.internal');
    const auditId = generateUuidV7();

    // Insert into partitioned audit_logs within tenant context
    await withTenant({ companyId, userId: generateUuidV7() }, async (_tx, client) => {
      await client.query(
        `INSERT INTO audit_logs (id, ts, company_id, action, entity, entity_id)
         VALUES ($1, now(), $2, $3, $4, $5)`,
        [auditId, companyId, 'test.create', 'user', generateUuidV7()],
      );

      const selectRes = await client.query('SELECT * FROM audit_logs WHERE id = $1', [auditId]);
      expect(selectRes.rows).toHaveLength(1);
      expect(selectRes.rows[0].action).toBe('test.create');

      // Attempting to UPDATE or DELETE must fail via role privilege / trigger
      await expect(
        client.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['tampered', auditId]),
      ).rejects.toThrow();

      await expect(
        client.query('DELETE FROM audit_logs WHERE id = $1', [auditId]),
      ).rejects.toThrow();
    }, db.appPool);
  });
});
