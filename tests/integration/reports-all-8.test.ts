import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  ReportService,
  ReportRegistry,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('P3-REP-02: All 8 Core Reports Validation Suite', () => {
  const reportService = new ReportService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let managerCtx: RequestContext;
  let managerEmpId: string;
  let managerUserId: string;
  let employeeId1: string;
  let employeeId2: string;
  let leaveTypeId: string;
  let testDeptId: string;

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
      requestId: 'test-req-rep02-admin',
      isAuthenticated: true,
    };

    managerUserId = generateUuidV7();
    managerEmpId = generateUuidV7();
    employeeId1 = generateUuidV7();
    employeeId2 = generateUuidV7();

    managerCtx = {
      companyId,
      userId: managerUserId,
      employeeId: managerEmpId,
      roles: ['manager'],
      permissions: [PERMISSIONS.REPORT_RUN],
      requestId: 'test-req-rep02-manager',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    await withTenant({ companyId }, async (_tx, client) => {
      // 0. Seed test department
      const deptRes = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, active)
         VALUES ($1, $2, 'Special Engineering', 'SPECENG', true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      testDeptId = deptRes.rows[0]!.id;

      // 1. Manager User and Employee
      const mUserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'dummy_hash', 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [managerUserId, companyId, 'rep.mgr@test.internal']
      );
      managerUserId = mUserRes.rows[0]!.id;

      const mEmpRes = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, status, doj, search_key, employment_type, department_id)
         VALUES ($1, $2, $3, 'RMGR01', 'Rachel', 'Manager', 'rmgr01@test.internal', 'active', '2024-01-15', 'rachel manager rmgr01', 'full_time', $4)
         ON CONFLICT (company_id, emp_code)
         DO UPDATE SET status = 'active', user_id = EXCLUDED.user_id, department_id = EXCLUDED.department_id, deleted_at = NULL
         RETURNING id`,
        [managerEmpId, companyId, managerUserId, testDeptId]
      );
      managerEmpId = mEmpRes.rows[0]!.id;
      managerCtx.employeeId = managerEmpId;

      // 2. Reportee 1 (Under Rachel)
      const emp1UserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'dummy_hash', 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [generateUuidV7(), companyId, 'rep.emp1@test.internal']
      );
      const emp1UserId = emp1UserRes.rows[0]!.id;

      const emp1Res = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, manager_id, status, doj, search_key, employment_type, department_id)
         VALUES ($1, $2, $3, 'REMP01', 'Bob', 'Builder', 'remp01@test.internal', $4, 'active', '2025-03-01', 'bob builder remp01', 'full_time', $5)
         ON CONFLICT (company_id, emp_code)
         DO UPDATE SET status = 'active', manager_id = EXCLUDED.manager_id, user_id = EXCLUDED.user_id, employment_type = EXCLUDED.employment_type, department_id = EXCLUDED.department_id, deleted_at = NULL
         RETURNING id`,
        [employeeId1, companyId, emp1UserId, managerEmpId, testDeptId]
      );
      employeeId1 = emp1Res.rows[0]!.id;

      // 3. Independent Employee 2 (Not under Rachel - Terminated leaver)
      const emp2UserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'dummy_hash', 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [generateUuidV7(), companyId, 'rep.emp2@test.internal']
      );
      const emp2UserId = emp2UserRes.rows[0]!.id;

      const emp2Res = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, status, doj, search_key, employment_type, deleted_at)
         VALUES ($1, $2, $3, 'REMP02', 'Charlie', 'Exiter', 'remp02@test.internal', 'terminated', '2024-06-01', 'charlie exiter remp02', 'full_time', '2026-08-15 10:00:00+00')
         ON CONFLICT (company_id, emp_code)
         DO UPDATE SET status = 'terminated', deleted_at = '2026-08-15 10:00:00+00', user_id = EXCLUDED.user_id
         RETURNING id`,
        [employeeId2, companyId, emp2UserId]
      );
      employeeId2 = emp2Res.rows[0]!.id;

      // 4. Leave Type & Balances
      const ltRes = await client.query<{ id: string }>(
        `SELECT id FROM leave_types WHERE company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (ltRes.rows[0]) {
        leaveTypeId = ltRes.rows[0].id;
      } else {
        leaveTypeId = generateUuidV7();
        await client.query(
          `INSERT INTO leave_types (id, company_id, code, name, is_paid, unit, allow_half_day, active)
           VALUES ($1, $2, 'EL', 'Earned Leave', true, 'day', true, true)`,
          [leaveTypeId, companyId]
        );
      }

      await client.query(
        `INSERT INTO leave_balances (
          id, company_id, employee_id, leave_type_id, period_key, opening, accrued, used, adjusted, pending, closing, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, '2026', '12.000', '6.000', '2.000', '0.000', '1.000', '16.000', $5, $5
        ) ON CONFLICT (company_id, employee_id, leave_type_id, period_key) DO UPDATE
          SET closing = '16.000', used = '2.000'`,
        [generateUuidV7(), companyId, employeeId1, leaveTypeId, adminUserId]
      );

      // 5. Leave Request
      await client.query(
        `INSERT INTO leave_requests (
          id, company_id, employee_id, leave_type_id, from_date, to_date, days, reason, status, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, '2026-09-05', '2026-09-06', '2.000', 'Family trip', 'approved', $5, $5
        ) ON CONFLICT (company_id, id) DO NOTHING`,
        [generateUuidV7(), companyId, employeeId1, leaveTypeId, adminUserId]
      );

      // 6. Attendance Days (Exception & Normal)
      await client.query(
        `INSERT INTO attendance_days (
          id, company_id, employee_id, work_date, status, total_work_minutes,
          first_in, last_out, late_in_minutes, early_out_minutes, is_regularized, created_by, updated_by
        ) VALUES (
          $1, $2, $3, '2026-08-04', 'present', 180,
          '2026-08-04 09:30:00+00', NULL, 30, 0, false, $4, $4
        ) ON CONFLICT (company_id, employee_id, work_date) DO UPDATE
          SET total_work_minutes = 180, last_out = NULL`,
        [generateUuidV7(), companyId, employeeId1, adminUserId]
      );

      // 7. Attendance Period Summary
      await client.query(
        `INSERT INTO attendance_period_summary (
          id, company_id, employee_id, period, present, absent, half_days,
          late_count, early_exit_count, weekly_off, holidays, leave_days,
          worked_minutes, overtime_minutes, lop_days
        ) VALUES (
          $1, $2, $3, '2026-08', 21.0, 0.0, 0, 1, 0, 8.0, 1.0, 1.0, 10080, 0, 0.0
        ) ON CONFLICT (company_id, employee_id, period) DO UPDATE
          SET present = EXCLUDED.present`,
        [generateUuidV7(), companyId, employeeId1]
      );
    }, ownerPool);
  });

  it('registry has all 8 core reports registered with valid schemas and permissions', () => {
    const allReports = ReportRegistry.getAll();
    expect(allReports.length).toBeGreaterThanOrEqual(8);

    const keys = allReports.map(r => r.key);
    expect(keys).toContain('attendance_summary');
    expect(keys).toContain('daily_attendance_register');
    expect(keys).toContain('late_marks_and_absenteeism');
    expect(keys).toContain('attendance_exceptions');
    expect(keys).toContain('leave_balances');
    expect(keys).toContain('leave_usage');
    expect(keys).toContain('headcount');
    expect(keys).toContain('joiners_and_leavers');

    for (const report of allReports) {
      expect(report.title).toBeDefined();
      expect(report.columns.length).toBeGreaterThan(3);
      expect(report.permission).toBe(PERMISSIONS.REPORT_RUN);
    }
  });

  it('Report 4 (attendance_exceptions): accurately detects missing punch / short duration', async () => {
    const ownerPool = getOwnerPool();
    const result = await reportService.preview(
      adminCtx,
      'attendance_exceptions',
      { startDate: '2026-08-01', endDate: '2026-08-10' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(result.key).toBe('attendance_exceptions');
    const match = result.rows.find(r => r.empCode === 'REMP01' && r.date === '2026-08-04');
    expect(match).toBeDefined();
    expect(match!.exceptionType).toBe('Missing Swipe');
    expect(match!.outTime).toBe('-');
    expect(match!.regularized).toBe('No');
  });

  it('Report 5 (leave_balances): verifies employee leave ledger balance snapshot', async () => {
    const ownerPool = getOwnerPool();
    const result = await reportService.preview(
      adminCtx,
      'leave_balances',
      { periodKey: '2026' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(result.key).toBe('leave_balances');
    const match = result.rows.find(r => r.empCode === 'REMP01');
    expect(match).toBeDefined();
    expect(match!.opening).toBe(12);
    expect(match!.accrued).toBe(6);
    expect(match!.used).toBe(2);
    expect(match!.closing).toBe(16);
  });

  it('Report 6 (leave_usage): retrieves approved and historical leave applications', async () => {
    const ownerPool = getOwnerPool();
    const result = await reportService.preview(
      adminCtx,
      'leave_usage',
      { startDate: '2026-09-01', endDate: '2026-09-10' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(result.key).toBe('leave_usage');
    const match = result.rows.find(r => r.empCode === 'REMP01');
    expect(match).toBeDefined();
    expect(match!.days).toBe(2);
    expect(match!.status).toBe('approved');
    expect(match!.reason).toBe('Family trip');
  });

  it('Report 7 (headcount): displays active staffing roster with details', async () => {
    const ownerPool = getOwnerPool();
    const result = await reportService.preview(
      adminCtx,
      'headcount',
      { status: 'active', departmentId: testDeptId },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(result.key).toBe('headcount');
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const bob = result.rows.find(r => r.empCode === 'REMP01');
    expect(bob).toBeDefined();
    expect(bob!.employmentType).toBe('full_time');
    expect(bob!.status).toBe('active');
  });

  it('Report 8 (joiners_and_leavers): correctly categorizes joiners and leavers in period', async () => {
    const ownerPool = getOwnerPool();
    const result = await reportService.preview(
      adminCtx,
      'joiners_and_leavers',
      { startDate: '2026-08-01', endDate: '2026-08-31' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(result.key).toBe('joiners_and_leavers');
    const leaver = result.rows.find(r => r.empCode === 'REMP02');
    expect(leaver).toBeDefined();
    expect(leaver!.eventType).toBe('Leaver');
    expect(leaver!.eventDate).toBe('2026-08-15');
    expect(leaver!.tenureMonths).toBeGreaterThan(20);
  });

  it('Scope enforcement: manager only sees their reportees, not independent employees', async () => {
    const ownerPool = getOwnerPool();

    // Manager Rachel views headcount
    const mgrHeadcount = await reportService.preview(
      managerCtx,
      'headcount',
      {},
      { page: 1, pageSize: 50 },
      ownerPool
    );

    const empCodes = mgrHeadcount.rows.map(r => r.empCode);
    // Manager Rachel sees herself and Bob (her reportee)
    expect(empCodes).toContain('RMGR01');
    expect(empCodes).toContain('REMP01');
    // But does NOT see REMP02 (outside Rachel's tree)
    expect(empCodes).not.toContain('REMP02');
  });

  it('Async export works across new reports with MinIO streaming and audit entry', async () => {
    const ownerPool = getOwnerPool();

    const exportRes = await reportService.export(
      adminCtx,
      'leave_balances',
      { periodKey: '2026' },
      'csv',
      ownerPool
    );

    expect(exportRes.status).toBe('done');
    expect(exportRes.rows).toBeGreaterThanOrEqual(1);
    expect(exportRes.downloadUrl).toContain('http');
    expect(exportRes.fileName).toContain('leave_balances');
  });
});
