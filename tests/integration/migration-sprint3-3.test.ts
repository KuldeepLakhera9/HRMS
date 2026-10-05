import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  MigrationService,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('P3-MIG-01: Data Migration Tools Validation Suite', () => {
  const migrationService = new MigrationService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let employeeId1: string;
  let employeeId2: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    await runMigrations();
    const seedResult = await seedDatabase();
    companyId = seedResult.companyId;

    const userRes = await getOwnerPool().query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2 LIMIT 1`,
      [companyId, seedResult.adminEmail]
    );
    adminUserId = userRes.rows[0]?.id ?? generateUuidV7();

    adminCtx = {
      companyId,
      userId: adminUserId,
      roles: ['super_admin'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-req-mig-admin',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Employees for migration testing
      const emp1Res = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, emp_code, first_name, last_name, email_work, status, doj, search_key)
         VALUES ($1, $2, 'MIG_EMP1', 'Arthur', 'Dent', 'mig1@test.internal', 'active', '2025-01-01', 'arthur dent')
         ON CONFLICT (company_id, emp_code) DO UPDATE SET status = 'active', deleted_at = NULL
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      employeeId1 = emp1Res.rows[0]!.id;

      const emp2Res = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, emp_code, first_name, last_name, email_work, status, doj, search_key)
         VALUES ($1, $2, 'MIG_EMP2', 'Trillian', 'Astra', 'mig2@test.internal', 'active', '2025-01-01', 'trillian astra')
         ON CONFLICT (company_id, emp_code) DO UPDATE SET status = 'active', deleted_at = NULL
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      employeeId2 = emp2Res.rows[0]!.id;

      // 2. Leave type
      const ltRes = await client.query<{ id: string }>(
        `INSERT INTO leave_types (id, company_id, code, name, is_paid, unit, active)
         VALUES ($1, $2, 'PL', 'Privilege Leave', true, 'day', true)
         ON CONFLICT (company_id, code) DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      leaveTypeId = ltRes.rows[0]!.id;
    }, ownerPool);
  });

  describe('Opening Leave Balances Migration', () => {
    let batchId: string;

    it('previews CSV and catches errors for invalid employee or balance', async () => {
      const ownerPool = getOwnerPool();

      const csvContent = `emp_code,leave_type_code,period_year,opening_balance
MIG_EMP1,PL,2026,14.5
MIG_EMP2,PL,2026,10.0
UNKNOWN_999,PL,2026,5.0
MIG_EMP1,BAD_TYPE,2026,5.0
MIG_EMP2,PL,2026,-3.0
`;

      const preview = await migrationService.previewLeaveBalances(adminCtx, csvContent, ownerPool);

      expect(preview.type).toBe('leave_balances');
      expect(preview.totalRows).toBe(5);
      expect(preview.validRows).toBe(2);
      expect(preview.errorRows).toBe(3);
      expect(preview.preview.length).toBe(2);

      const err1 = preview.errors.find(e => e.empCode === 'UNKNOWN_999');
      expect(err1).toBeDefined();
      expect(err1!.reason).toContain('not found in company');

      const err2 = preview.errors.find(e => e.reason.includes('BAD_TYPE'));
      expect(err2).toBeDefined();

      const err3 = preview.errors.find(e => e.reason.includes('non-negative'));
      expect(err3).toBeDefined();

      batchId = preview.batchId;
    });

    it('generates downloadable error CSV matching validation issues', async () => {
      const ownerPool = getOwnerPool();
      const errorCsv = await migrationService.getBatchErrorCsv(adminCtx, batchId, ownerPool);

      expect(errorCsv).toContain('Row Number,Reason,Raw Data');
      expect(errorCsv).toContain('UNKNOWN_999');
      expect(errorCsv).toContain('BAD_TYPE');
      expect(errorCsv).toContain('non-negative');
    });

    it('confirms previewed batch, inserting ledger entries and updating leave balances', async () => {
      const ownerPool = getOwnerPool();

      const confirmResult = await migrationService.confirmLeaveBalances(adminCtx, batchId, ownerPool);
      expect(confirmResult.status).toBe('completed');
      expect(confirmResult.processedCount).toBe(2);

      // Verify leave_balances in DB
      await withTenant({ companyId }, async (_tx, client) => {
        const bal1 = await client.query<{ opening: string; closing: string }>(
          `SELECT opening, closing FROM leave_balances 
           WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND period_key = '2026'`,
          [companyId, employeeId1, leaveTypeId],
        );
        expect(bal1.rows.length).toBe(1);
        expect(parseFloat(bal1.rows[0]!.opening)).toBe(14.5);
        expect(parseFloat(bal1.rows[0]!.closing)).toBe(14.5);

        const bal2 = await client.query<{ opening: string; closing: string }>(
          `SELECT opening, closing FROM leave_balances 
           WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND period_key = '2026'`,
          [companyId, employeeId2, leaveTypeId],
        );
        expect(bal2.rows.length).toBe(1);
        expect(parseFloat(bal2.rows[0]!.opening)).toBe(10.0);
        expect(parseFloat(bal2.rows[0]!.closing)).toBe(10.0);

        // Verify ledger entries
        const ledger = await client.query(
          `SELECT COUNT(*)::int AS count FROM leave_ledger 
           WHERE company_id = $1 AND ref_id = $2 AND entry_type = 'opening'`,
          [companyId, batchId],
        );
        expect(ledger.rows[0]!.count).toBe(2);
      }, ownerPool);
    });

    it('reverts opening leave balance batch cleanly', async () => {
      const ownerPool = getOwnerPool();

      const revertResult = await migrationService.revertLeaveBalances(adminCtx, batchId, ownerPool);
      expect(revertResult.status).toBe('reverted');
      expect(revertResult.revertedCount).toBe(2);

      // Verify leave_balances restored
      await withTenant({ companyId }, async (_tx, client) => {
        const bal1 = await client.query<{ opening: string; closing: string }>(
          `SELECT opening, closing FROM leave_balances 
           WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND period_key = '2026'`,
          [companyId, employeeId1, leaveTypeId],
        );
        expect(bal1.rows.length).toBe(1);
        expect(parseFloat(bal1.rows[0]!.opening)).toBe(0);
        expect(parseFloat(bal1.rows[0]!.closing)).toBe(0);
      }, ownerPool);
    });
  });

  describe('Historical Attendance Migration', () => {
    let attBatchId: string;

    it('previews attendance CSV and identifies valid vs invalid rows', async () => {
      const ownerPool = getOwnerPool();

      const csvContent = `emp_code,date,in_time,out_time,status
MIG_EMP1,2026-07-01,09:00:00,18:00:00,present
MIG_EMP2,2026-07-01,09:30:00,18:30:00,present
MIG_EMP1,2026-07-02,,,absent
NON_EXISTENT,2026-07-01,09:00:00,18:00:00,present
`;

      const preview = await migrationService.previewAttendance(adminCtx, csvContent, ownerPool);
      expect(preview.type).toBe('attendance_punches');
      expect(preview.totalRows).toBe(4);
      expect(preview.validRows).toBe(3);
      expect(preview.errorRows).toBe(1);
      expect(preview.errors[0]!.empCode).toBe('NON_EXISTENT');

      attBatchId = preview.batchId;
    });

    it('confirms attendance batch and writes computed attendance_days', async () => {
      const ownerPool = getOwnerPool();

      const confirmResult = await migrationService.confirmAttendance(adminCtx, attBatchId, ownerPool);
      expect(confirmResult.status).toBe('completed');
      expect(confirmResult.processedCount).toBe(3);

      // Verify attendance_days in DB
      await withTenant({ companyId }, async (_tx, client) => {
        const day1 = await client.query<{ status: string; total_work_minutes: number }>(
          `SELECT status, total_work_minutes FROM attendance_days 
           WHERE company_id = $1 AND employee_id = $2 AND work_date = '2026-07-01'`,
          [companyId, employeeId1],
        );
        expect(day1.rows.length).toBe(1);
        expect(day1.rows[0]!.status).toBe('present');
        expect(day1.rows[0]!.total_work_minutes).toBe(540); // 9 hours = 540 mins

        const day2 = await client.query<{ status: string; total_work_minutes: number }>(
          `SELECT status, total_work_minutes FROM attendance_days 
           WHERE company_id = $1 AND employee_id = $2 AND work_date = '2026-07-02'`,
          [companyId, employeeId1],
        );
        expect(day2.rows.length).toBe(1);
        expect(day2.rows[0]!.status).toBe('absent');
        expect(day2.rows[0]!.total_work_minutes).toBe(0);
      }, ownerPool);
    });

    it('lists past migration batches for the company', async () => {
      const ownerPool = getOwnerPool();
      const batches = await migrationService.listBatches(adminCtx, ownerPool);

      expect(batches.length).toBeGreaterThanOrEqual(2);
      const leaveBatch = batches.find(b => b.id === attBatchId);
      expect(leaveBatch).toBeDefined();
      expect(leaveBatch!.status).toBe('completed');
    });
  });
});
