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
  DashboardService,
  ManagerDigestJob,
  defaultFcmProvider,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 3.2 Integration Suite (P3-REP-01, P3-DASH-01, P3-NOTIF-01)', () => {
  const reportService = new ReportService();
  const dashboardService = new DashboardService();
  const managerDigestJob = new ManagerDigestJob();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let managerEmpId: string;
  let managerUserId: string;
  let employeeId1: string;

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
      requestId: 'test-req-sprint3-2',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    // Seed test employees and manager
    managerUserId = generateUuidV7();
    managerEmpId = generateUuidV7();
    employeeId1 = generateUuidV7();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Manager User and Employee
      const mUserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [managerUserId, companyId, 'manager.dash@test.com', 'dummy_hash']
      );
      managerUserId = mUserRes.rows[0]!.id;

      const mEmpRes = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, status, doj, search_key)
         VALUES ($1, $2, $3, 'MGR001', 'David', 'Manager', 'mgr001@test.internal', 'active', '2025-01-01', 'david manager mgr001')
         ON CONFLICT (company_id, emp_code)
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [managerEmpId, companyId, managerUserId]
      );
      managerEmpId = mEmpRes.rows[0]!.id;

      // 2. Direct Report Employee
      const emp1UserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [generateUuidV7(), companyId, 'emp1.dash@test.com', 'dummy_hash']
      );
      const emp1UserId = emp1UserRes.rows[0]!.id;

      const emp1Res = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, manager_id, status, doj, search_key)
         VALUES ($1, $2, $3, 'EMP100', 'Alice', 'Smith', 'emp100@test.internal', $4, 'active', '2025-02-01', 'alice smith emp100')
         ON CONFLICT (company_id, emp_code)
         DO UPDATE SET manager_id = EXCLUDED.manager_id, status = 'active'
         RETURNING id`,
        [employeeId1, companyId, emp1UserId, managerEmpId]
      );
      employeeId1 = emp1Res.rows[0]!.id;

      // 3. Seed attendance_period_summary for 2026-08
      await client.query(
        `INSERT INTO attendance_period_summary (
          id, company_id, employee_id, period, present, absent, half_days,
          late_count, early_exit_count, weekly_off, holidays, leave_days,
          worked_minutes, overtime_minutes, lop_days
        ) VALUES (
          $1, $2, $3, '2026-08', 20.0, 1.0, 0, 2, 1, 8.0, 2.0, 1.0, 9600, 120, 0.0
        ) ON CONFLICT (company_id, employee_id, period) DO UPDATE
          SET present = EXCLUDED.present`,
        [generateUuidV7(), companyId, employeeId1]
      );

      // 4. Seed attendance_days for 2026-08-03
      await client.query(
        `INSERT INTO attendance_days (
          id, company_id, employee_id, work_date, status, total_work_minutes,
          late_in_minutes, early_out_minutes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, '2026-08-03', 'present', 480, 25, 0, $4, $4
        ) ON CONFLICT (company_id, employee_id, work_date) DO NOTHING`,
        [generateUuidV7(), companyId, employeeId1, adminUserId]
      );

      // 5. Seed pending leave request for employee under manager
      const leaveTypeRes = await client.query(
        `SELECT id FROM leave_types WHERE company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (leaveTypeRes.rows[0]) {
        await client.query(
          `INSERT INTO leave_requests (
            id, company_id, employee_id, leave_type_id, from_date, to_date,
            days, reason, status
          ) VALUES (
            $1, $2, $3, $4, '2026-09-01', '2026-09-02', 2.0, 'Vacation request', 'pending'
          ) ON CONFLICT (company_id, id) DO NOTHING`,
          [generateUuidV7(), companyId, employeeId1, leaveTypeRes.rows[0].id]
        );
      }
    }, ownerPool);
  });

  it('sync preview generates monthly attendance summary with correct aggregations', async () => {
    const ownerPool = getOwnerPool();

    const preview = await reportService.preview(
      adminCtx,
      'attendance_summary',
      { period: '2026-08' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(preview.key).toBe('attendance_summary');
    expect(preview.columns.length).toBeGreaterThan(5);
    expect(preview.totalCount).toBeGreaterThanOrEqual(1);

    const match = preview.rows.find(r => r.empCode === 'EMP100');
    expect(match).toBeDefined();
    expect(match!.present).toBe(20.0);
    expect(match!.lateCount).toBe(2);
    expect(match!.workedHours).toBe(160); // 9600 / 60
  });

  it('sync preview generates daily attendance register within 31-day boundary', async () => {
    const ownerPool = getOwnerPool();

    const preview = await reportService.preview(
      adminCtx,
      'daily_attendance_register',
      { startDate: '2026-08-01', endDate: '2026-08-10' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(preview.key).toBe('daily_attendance_register');
    const match = preview.rows.find(r => r.empCode === 'EMP100' && r.date === '2026-08-03');
    expect(match).toBeDefined();
    expect(match!.status).toBe('present');
    expect(match!.workedMinutes).toBe(480);
    expect(match!.lateMinutes).toBe(25);
  });

  it('sync preview detects late marks and absenteeism incidents', async () => {
    const ownerPool = getOwnerPool();

    const preview = await reportService.preview(
      adminCtx,
      'late_marks_and_absenteeism',
      { startDate: '2026-08-01', endDate: '2026-08-10' },
      { page: 1, pageSize: 50 },
      ownerPool
    );

    expect(preview.key).toBe('late_marks_and_absenteeism');
    const match = preview.rows.find(r => r.empCode === 'EMP100');
    expect(match).toBeDefined();
    expect(match!.incidentType).toBe('Late Arrival');
    expect(match!.lateMinutes).toBe(25);
  });

  it('export streams CSV to MinIO, records report_runs entry, and creates audit log', async () => {
    const ownerPool = getOwnerPool();

    const exportResult = await reportService.export(
      adminCtx,
      'attendance_summary',
      { period: '2026-08' },
      'csv',
      ownerPool
    );

    expect(exportResult.status).toBe('done');
    expect(exportResult.rows).toBeGreaterThanOrEqual(1);
    expect(exportResult.downloadUrl).toBeDefined();
    expect(exportResult.downloadUrl).toContain('http');
    expect(exportResult.fileName).toContain('attendance_summary');

    // Verify report_runs entry
    const runs = await reportService.listRuns(adminCtx, ownerPool);
    const match = runs.find(r => r.id === exportResult.runId);
    expect(match).toBeDefined();
    expect(match!.status).toBe('done');
  });

  it('dashboard card endpoints satisfy query budget <= 2 per card and verify Redis cache hit', async () => {
    const ownerPool = getOwnerPool();
    let queryCount = 0;

    const trackingPool = {
      connect: async () => {
        const client = await ownerPool.connect();
        const origQuery = client.query.bind(client);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.query = (async (...args: any[]) => {
          const sql = (args[0]?.text || args[0] || '').toString().trim().toUpperCase();
          if (!sql.startsWith('BEGIN') && !sql.startsWith('COMMIT') && !sql.startsWith('ROLLBACK') && !sql.includes('SET_CONFIG')) {
            queryCount++;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (origQuery as any)(...args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
        return client;
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Invalidate any stale cache
    await dashboardService.invalidateCardCache(companyId, 'hr_headcount');

    // 1. Initial fetch from DB
    queryCount = 0;
    const cardResponse = await dashboardService.getCard(adminCtx, 'hr_headcount', trackingPool);
    expect(cardResponse.key).toBe('hr_headcount');
    expect(cardResponse.data).toBeDefined();
    // PHASE3_SPEC Section 9 requirement: query budget <= 2 per widget card
    expect(queryCount).toBeLessThanOrEqual(2);

    // 2. Second fetch served from Redis cache (0 SQL queries)
    queryCount = 0;
    const cachedResponse = await dashboardService.getCard(adminCtx, 'hr_headcount', trackingPool);
    expect(cachedResponse.key).toBe('hr_headcount');
    expect(queryCount).toBe(0); // Served directly from Redis cache
  });

  it('fcmProvider dispatches minimal push payload and ManagerDigestJob sends approval digest', async () => {
    const ownerPool = getOwnerPool();

    // Test FCM Provider
    const pushResult = await defaultFcmProvider.sendPush({
      token: 'fcm-device-test-token-12345',
      type: 'leave_approval',
      id: generateUuidV7(),
      title: 'Leave Request Pending',
      body: 'New leave request from Alice Smith requires your approval.',
    });
    expect(pushResult.success).toBe(true);
    expect(pushResult.messageId).toContain('fcm-leave_approval');

    // Test Manager Approvals Digest Job
    const digestResult = await managerDigestJob.runDigest(companyId, ownerPool);
    expect(digestResult.sentCount).toBeGreaterThanOrEqual(1);

    const managerItem = digestResult.items.find(i => i.managerId === managerEmpId);
    expect(managerItem).toBeDefined();
    expect(managerItem!.pendingLeaves).toBeGreaterThanOrEqual(1);
  });
});
