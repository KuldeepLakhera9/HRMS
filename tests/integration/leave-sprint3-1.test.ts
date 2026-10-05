import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  LeaveService,
  LeaveBalanceRepository,
  LeaveLedgerRepository,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 3.1 Integration Suite (P3-LV-01, P3-LV-02, P3-LV-03, P3-LV-04, P3-HOL-01, P3-INT-01)', () => {
  const leaveService = new LeaveService();
  const balanceRepo = new LeaveBalanceRepository();
  const ledgerRepo = new LeaveLedgerRepository();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let employeeId1: string;
  let employeeId2: string;
  let leaveTypePaidId: string;
  let leaveTypeUnpaidId: string;
  let policyPaidId: string;
  let holidayListId: string;

  beforeAll(async () => {
    await runMigrations();
    const seed = await seedDatabase();
    companyId = seed.companyId;

    const ownerPool = getOwnerPool();

    // 1. Resolve Admin User ID
    const userRes = await ownerPool.query<{ id: string }>(
      'SELECT id FROM users WHERE company_id = $1 LIMIT 1',
      [companyId],
    );
    adminUserId = userRes.rows[0]?.id || generateUuidV7();

    // 2. Resolve or create employees
    const empRes = await withTenant({ companyId }, async (_tx, client) => {
      const res = await client.query<{ id: string }>(
        'SELECT id FROM employees WHERE company_id = $1 LIMIT 2',
        [companyId],
      );
      return res.rows;
    }, ownerPool);

    if (empRes.length >= 2 && empRes[0] && empRes[1]) {
      employeeId1 = empRes[0].id;
      employeeId2 = empRes[1].id;
    } else {
      employeeId1 = generateUuidV7();
      employeeId2 = generateUuidV7();
      await withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `INSERT INTO employees (
            id, company_id, emp_code, first_name, last_name, email_work,
            employment_type, doj, job_effective_from, status, search_key, user_id,
            created_by, updated_by, created_at, updated_at
          ) VALUES
          ($1, $3, 'EMP-LV-1', 'Leave', 'User1', 'leave1@orghub.internal', 'full_time', '2026-01-01', '2026-01-01', 'active', 'leave user1', $4, $4, $4, now(), now()),
          ($2, $3, 'EMP-LV-2', 'Leave', 'User2', 'leave2@orghub.internal', 'full_time', '2026-01-01', '2026-01-01', 'active', 'leave user2', $4, $4, $4, now(), now())
          ON CONFLICT DO NOTHING`,
          [employeeId1, employeeId2, companyId, adminUserId],
        );
      }, ownerPool);
    }

    adminCtx = {
      isAuthenticated: true,
      companyId,
      userId: adminUserId,
      employeeId: employeeId1,
      roles: ['admin'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-req-sprint3-1',
    };

    // 3. Create Leave Types & Policies for testing
    leaveTypePaidId = generateUuidV7();
    leaveTypeUnpaidId = generateUuidV7();
    policyPaidId = generateUuidV7();
    holidayListId = generateUuidV7();

    await withTenant({ companyId }, async (_tx, client) => {
      // Create Paid Casual Leave (CL)
      const clRes = await client.query<{ id: string }>(
        `INSERT INTO leave_types (
          id, company_id, code, name, is_paid, unit, allow_half_day, allow_hourly,
          requires_document_after_days, max_consecutive_days, min_notice_days,
          sandwich_rule, allow_negative_balance, negative_limit, active,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'CL', 'Casual Leave', true, 'day', true, false,
          3, 5, 0,
          'none', false, 0, true,
          $3, $3, now(), now()
        ) ON CONFLICT (company_id, code) DO UPDATE SET updated_at = now()
        RETURNING id`,
        [leaveTypePaidId, companyId, adminUserId],
      );
      leaveTypePaidId = clRes.rows[0]!.id;

      // Create Unpaid LOP
      const lopRes = await client.query<{ id: string }>(
        `INSERT INTO leave_types (
          id, company_id, code, name, is_paid, unit, allow_half_day, allow_hourly,
          requires_document_after_days, min_notice_days,
          sandwich_rule, allow_negative_balance, negative_limit, active,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'LOP', 'Loss of Pay', false, 'day', true, false,
          null, 0,
          'none', true, 30, true,
          $3, $3, now(), now()
        ) ON CONFLICT (company_id, code) DO UPDATE SET updated_at = now()
        RETURNING id`,
        [leaveTypeUnpaidId, companyId, adminUserId],
      );
      leaveTypeUnpaidId = lopRes.rows[0]!.id;

      // Create default policy for CL
      const polRes = await client.query<{ id: string }>(
        `INSERT INTO leave_policies (
          id, company_id, leave_type_id, version, effective_from, accrual, carry_forward,
          max_balance, probation_rule, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 1, '2026-01-01',
          '{"frequency":"monthly","amount":2.0,"proRata":true,"rounding":0.5}'::jsonb,
          '{"enabled":true,"maxDays":15,"expiryDays":90}'::jsonb,
          30,
          '{"allowDuringProbation":true,"accrueDuringProbation":true}'::jsonb,
          $4, $4, now(), now()
        ) ON CONFLICT (company_id, leave_type_id, version) DO UPDATE SET updated_at = now()
        RETURNING id`,
        [policyPaidId, companyId, leaveTypePaidId, adminUserId],
      );
      policyPaidId = polRes.rows[0]!.id;

      // Policy assignment (company scope)
      await client.query(
        `INSERT INTO leave_policy_assignments (
          id, company_id, scope_type, scope_id, leave_type_id, policy_id,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'company', null, $3, $4,
          $5, $5, now(), now()
        ) ON CONFLICT DO NOTHING`,
        [generateUuidV7(), companyId, leaveTypePaidId, policyPaidId, adminUserId],
      );

      // Create Holiday list & sample holiday
      const hlRes = await client.query<{ id: string }>(
        `INSERT INTO holiday_lists (
          id, company_id, name, year, is_default, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'Standard Holidays 2026', 2026, true, $3, $3, now(), now()
        ) ON CONFLICT DO NOTHING
        RETURNING id`,
        [holidayListId, companyId, adminUserId],
      );
      if (hlRes.rows.length > 0 && hlRes.rows[0]) {
        holidayListId = hlRes.rows[0].id;
      } else {
        const existingHl = await client.query<{ id: string }>(
          `SELECT id FROM holiday_lists WHERE company_id = $1 AND is_default = true LIMIT 1`,
          [companyId],
        );
        if (existingHl.rows[0]) holidayListId = existingHl.rows[0].id;
      }

      await client.query(
        `INSERT INTO holidays (
          id, company_id, list_id, name, date, type, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'Republic Day', '2026-01-26', 'public', $4, $4, now(), now()
        ) ON CONFLICT DO NOTHING`,
        [generateUuidV7(), companyId, holidayListId, adminUserId],
      );
    }, ownerPool);
  });

  it('enforces append-only trigger on leave_ledger (rejects UPDATE and DELETE)', async () => {
    const ownerPool = getOwnerPool();
    const entryId = generateUuidV7();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Insert directly into leave_ledger
      await client.query(
        `INSERT INTO leave_ledger (
          id, company_id, employee_id, leave_type_id, period_key,
          entry_type, delta_days, effective_date, created_by, created_at
        ) VALUES ($1, $2, $3, $4, '2026', 'opening', 10.0, '2026-01-01', $5, now())`,
        [entryId, companyId, employeeId1, leaveTypePaidId, adminUserId],
      );

      // 2. Attempt UPDATE - must fail via trigger
      await client.query('SAVEPOINT sp_update');
      await expect(
        client.query(
          `UPDATE leave_ledger SET delta_days = 20.0 WHERE id = $1`,
          [entryId],
        ),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_update');

      // 3. Attempt DELETE - must fail via trigger
      await client.query('SAVEPOINT sp_delete');
      await expect(
        client.query(
          `DELETE FROM leave_ledger WHERE id = $1`,
          [entryId],
        ),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');
    }, ownerPool);
  });

  it('enforces EXCLUDE overlap constraint on leave_request_days (rejects overlapping periods)', async () => {
    const ownerPool = getOwnerPool();
    const req1Id = generateUuidV7();
    const req2Id = generateUuidV7();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Create first leave request
      await client.query(
        `INSERT INTO leave_requests (
          id, company_id, employee_id, leave_type_id, from_date, to_date,
          from_part, to_part, days, reason, status, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, '2026-06-10', '2026-06-12',
          'full', 'full', 3, 'Vacation', 'pending', $5, $5, now(), now()
        )`,
        [req1Id, companyId, employeeId1, leaveTypePaidId, adminUserId],
      );

      // Insert request day with period range: 2026-06-10 00:00 to 2026-06-10 23:59:59.999
      await client.query(
        `INSERT INTO leave_request_days (
          id, company_id, request_id, employee_id, leave_date, period, part, days,
          is_paid, status, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, '2026-06-10',
          tstzrange('2026-06-10 00:00:00Z', '2026-06-10 23:59:59.999Z', '[)'),
          'full', 1, true, 'pending', $5, $5, now(), now()
        )`,
        [generateUuidV7(), companyId, req1Id, employeeId1, adminUserId],
      );

      // 2. Create second leave request
      await client.query(
        `INSERT INTO leave_requests (
          id, company_id, employee_id, leave_type_id, from_date, to_date,
          from_part, to_part, days, reason, status, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, '2026-06-10', '2026-06-11',
          'full', 'full', 2, 'Clash attempt', 'pending', $5, $5, now(), now()
        )`,
        [req2Id, companyId, employeeId1, leaveTypePaidId, adminUserId],
      );

      // 3. Attempting to insert overlapping period for same employee must be rejected by EXCLUDE constraint
      await expect(
        client.query(
          `INSERT INTO leave_request_days (
            id, company_id, request_id, employee_id, leave_date, period, part, days,
            is_paid, status, created_by, updated_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, '2026-06-10',
            tstzrange('2026-06-10 00:00:00Z', '2026-06-10 23:59:59.999Z', '[)'),
            'full', 1, true, 'pending', $5, $5, now(), now()
          )`,
          [generateUuidV7(), companyId, req2Id, employeeId1, adminUserId],
        ),
      ).rejects.toThrow();
    }, ownerPool);
  });

  it('handles concurrent leave submissions with row-locking (prevents balance overdraft)', async () => {
    const ownerPool = getOwnerPool();
    const testEmpId = generateUuidV7();

    const raceEmpCode = `EMP-RACE-${generateUuidV7().slice(-6)}`;

    // Create a new employee with exact opening balance = 2 days
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO employees (
          id, company_id, emp_code, first_name, last_name, email_work,
          employment_type, doj, job_effective_from, status, search_key, user_id,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $4, 'Race', 'Runner', 'race@orghub.internal',
          'full_time', '2026-01-01', '2026-01-01', 'active', 'race runner', $3,
          $3, $3, now(), now()
        )`,
        [testEmpId, companyId, adminUserId, raceEmpCode],
      );

      // Set initial balance = 2 days
      const bal = await balanceRepo.getOrCreateBalance(companyId, testEmpId, leaveTypePaidId, '2026', client);
      await balanceRepo.updateBalance(companyId, bal.id, { opening: 2.0 }, client);
    }, ownerPool);

    const empCtx: RequestContext = {
      isAuthenticated: true,
      companyId,
      userId: adminUserId,
      employeeId: testEmpId,
      roles: ['employee'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-race-req',
    };

    // Attempt 5 concurrent requests of 1 day each (only 2 can succeed, remaining 3 must fail with Insufficient balance)
    const dates = [
      { from: '2026-07-01', to: '2026-07-01' },
      { from: '2026-07-02', to: '2026-07-02' },
      { from: '2026-07-03', to: '2026-07-03' },
      { from: '2026-07-06', to: '2026-07-06' },
      { from: '2026-07-07', to: '2026-07-07' },
    ];

    const results = await Promise.allSettled(
      dates.map((d, i) =>
        leaveService.submitRequest(
          empCtx,
          {
            employeeId: testEmpId,
            leaveTypeId: leaveTypePaidId,
            fromDate: d.from,
            toDate: d.to,
            reason: `Race submit #${i + 1}`,
          },
          ownerPool,
        ),
      ),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly 2 requests succeed, 3 fail due to balance check
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(3);

    // Verify closing/pending balance
    const finalBalance = await withTenant({ companyId }, async (_tx, client) => {
      return balanceRepo.getOrCreateBalance(companyId, testEmpId, leaveTypePaidId, '2026', client);
    }, ownerPool);

    expect(parseFloat(finalBalance.pending)).toBe(2.0);
    // Available = opening(2) - pending(2) = 0
    const available = parseFloat(finalBalance.closing) - parseFloat(finalBalance.pending);
    expect(available).toBe(0);
  });

  it('adjustBalance updates balance under lock and appends to immutable ledger', async () => {
    const ownerPool = getOwnerPool();

    const adjusted = await leaveService.adjustBalance(
      adminCtx,
      {
        employeeId: employeeId1,
        leaveTypeId: leaveTypePaidId,
        amount: 3.5,
        reason: 'Annual discretionary credit',
        year: 2026,
      },
      ownerPool,
    );

    expect(parseFloat(adjusted.adjusted)).toBeGreaterThanOrEqual(3.5);

    // Verify ledger entry
    const entries = await withTenant({ companyId }, async (_tx, client) => {
      return ledgerRepo.listEntries(companyId, employeeId1, { leaveTypeId: leaveTypePaidId, periodKey: '2026' }, client);
    }, ownerPool);

    const match = entries.find(e => e.reason === 'Annual discretionary credit');
    expect(match).toBeDefined();
    expect(parseFloat(match!.deltaDays)).toBe(3.5);
    expect(match!.entryType).toBe('adjustment');
  });

  it('previewLeave satisfies query budget <= 6', async () => {
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

    // Prime Redis policy cache
    await leaveService.previewLeave(
      adminCtx,
      {
        employeeId: employeeId1,
        leaveTypeId: leaveTypePaidId,
        fromDate: '2026-08-03',
        toDate: '2026-08-05',
      },
      ownerPool,
    );

    queryCount = 0;

    const preview = await leaveService.previewLeave(
      adminCtx,
      {
        employeeId: employeeId1,
        leaveTypeId: leaveTypePaidId,
        fromDate: '2026-08-03',
        toDate: '2026-08-05',
      },
      trackingPool,
    );

    expect(preview.breakdown.length).toBe(3);
    // PHASE3_SPEC Section 5.2 requirement: query budget <= 6
    expect(queryCount).toBeLessThanOrEqual(6);
  });

  it('getCalendar satisfies query budget <= 3', async () => {
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

    const calendar = await leaveService.getCalendar(
      adminCtx,
      {
        scope: 'company',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      },
      trackingPool,
    );

    expect(calendar).toBeDefined();
    expect(Array.isArray(calendar.leaves)).toBe(true);
    // PHASE3_SPEC Section 6 requirement: query budget <= 3
    expect(queryCount).toBeLessThanOrEqual(3);
  });
});
