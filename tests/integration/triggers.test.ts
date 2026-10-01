import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('Append-Only Defense-in-Depth Proof Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let auditLogId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany('Company Trigger Test', 'trigger.internal');

    auditLogId = generateUuidV7();
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO sample_audit_logs (id, company_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [auditLogId, companyId, 'USER_LOGIN', 'Initial login event recorded'],
      );
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  it('allows INSERT operations on append-only table as hrms_app', async () => {
    await withTenant({ companyId }, async (_tx, client) => {
      const newId = generateUuidV7();
      const res = await client.query(
        `INSERT INTO sample_audit_logs (id, company_id, action, details)
         VALUES ($1, $2, $3, $4)
         RETURNING id;`,
        [newId, companyId, 'PROFILE_VIEW', 'Employee profile viewed'],
      );
      expect(res.rows[0]?.id).toBe(newId);
    }, db.appPool);
  });

  it('PROOF (Layer 1): Rejects UPDATE/DELETE for hrms_app at role permission level (INSERT and SELECT only)', async () => {
    await expect(
      withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `UPDATE sample_audit_logs SET details = 'Tampered log content' WHERE id = $1`,
          [auditLogId],
        );
      }, db.appPool),
    ).rejects.toThrow(/permission denied for table sample_audit_logs/i);

    await expect(
      withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `DELETE FROM sample_audit_logs WHERE id = $1`,
          [auditLogId],
        );
      }, db.appPool),
    ).rejects.toThrow(/permission denied for table sample_audit_logs/i);
  });

  it('PROOF (Layer 2): Rejects UPDATE/DELETE via reject_update_delete() trigger when targeted row exists', async () => {
    const ownerClient = await db.ownerPool.connect();
    try {
      await ownerClient.query('BEGIN');
      await ownerClient.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      await expect(
        ownerClient.query(
          `UPDATE sample_audit_logs SET details = 'Tampered by owner' WHERE id = $1`,
          [auditLogId],
        ),
      ).rejects.toThrow(/append-only.*prohibited/i);

      await ownerClient.query('ROLLBACK');

      await ownerClient.query('BEGIN');
      await ownerClient.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      await expect(
        ownerClient.query(
          `DELETE FROM sample_audit_logs WHERE id = $1`,
          [auditLogId],
        ),
      ).rejects.toThrow(/append-only.*prohibited/i);

      await ownerClient.query('ROLLBACK');
    } finally {
      ownerClient.release();
    }
  });
});
