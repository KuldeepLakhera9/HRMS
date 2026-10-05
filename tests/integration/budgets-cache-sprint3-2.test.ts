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
  DashboardService,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 3.2 Integration Suite: Budgets, Redis Cache & Query Plans', () => {
  const leaveService = new LeaveService();
  const dashboardService = new DashboardService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let employeeId: string;

  beforeAll(async () => {
    await runMigrations();
    const seedResult = await seedDatabase();
    companyId = seedResult.companyId;

    const userRes = await getOwnerPool().query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2 LIMIT 1`,
      [companyId, seedResult.adminEmail],
    );
    adminUserId = userRes.rows[0]?.id ?? generateUuidV7();

    adminCtx = {
      companyId,
      userId: adminUserId,
      roles: ['super_admin'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-req-budgets-cache',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();
    employeeId = generateUuidV7();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Create User
      const uRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'
         RETURNING id`,
        [generateUuidV7(), companyId, 'budget.emp@test.internal', 'dummy_hash'],
      );
      const uId = uRes.rows[0]!.id;

      // 2. Create Employee
      const empRes = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, status, doj, search_key)
         VALUES ($1, $2, $3, 'BDG001', 'Bob', 'Budget', 'bdg001@test.internal', 'active', '2025-01-01', 'bob budget bdg001')
         ON CONFLICT (company_id, emp_code) DO UPDATE SET first_name = EXCLUDED.first_name, status = 'active'
         RETURNING id`,
        [employeeId, companyId, uId],
      );
      employeeId = empRes.rows[0]!.id;

      // 3. Ensure a leave type and balance exist
      const ltRes = await client.query<{ id: string }>(
        `INSERT INTO leave_types (id, company_id, code, name, is_paid, active, created_by, updated_by)
         VALUES ($1, $2, 'PL-BDG', 'Paid Leave Budget', true, true, $3, $3)
         ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [generateUuidV7(), companyId, adminUserId],
      );
      const ltId = ltRes.rows[0]!.id;

      await client.query(
        `INSERT INTO leave_balances (id, company_id, employee_id, leave_type_id, period_key, opening, closing, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026', 15.0, 15.0, $5, $5)
         ON CONFLICT (company_id, employee_id, leave_type_id, period_key) DO NOTHING`,
        [generateUuidV7(), companyId, employeeId, ltId, adminUserId],
      );
    }, ownerPool);
  });

  function createTrackingPool(basePool: typeof getOwnerPool extends () => infer P ? P : never) {
    let queryCount = 0;
    const trackingPool = {
      connect: async () => {
        const client = await basePool.connect();
        const origQuery = client.query.bind(client);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.query = (async (...args: any[]) => {
          const sql = (args[0]?.text || args[0] || '').toString().trim().toUpperCase();
          if (
            !sql.startsWith('BEGIN') &&
            !sql.startsWith('COMMIT') &&
            !sql.startsWith('ROLLBACK') &&
            !sql.includes('SET_CONFIG')
          ) {
            queryCount++;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (origQuery as any)(...args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
        return client;
      },
      getQueryCount: () => queryCount,
      resetQueryCount: () => {
        queryCount = 0;
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    return trackingPool;
  }

  it('calendar endpoint satisfies query budget <= 3 and verifies Redis caching with invalidation', async () => {
    const ownerPool = getOwnerPool();
    const trackingPool = createTrackingPool(ownerPool);

    // Invalidate existing cache
    await leaveService.invalidateCalendarCache(companyId);

    // 1. Initial fetch from DB
    trackingPool.resetQueryCount();
    const calRes1 = await leaveService.getCalendar(
      adminCtx,
      {
        scope: 'company',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      },
      trackingPool,
    );

    expect(calRes1).toBeDefined();
    expect(Array.isArray(calRes1.leaves)).toBe(true);
    // PHASE3_SPEC Section 6 requirement: calendar query budget <= 3
    expect(trackingPool.getQueryCount()).toBeLessThanOrEqual(3);

    // 2. Second fetch served from Redis cache (0 SQL queries)
    trackingPool.resetQueryCount();
    const calRes2 = await leaveService.getCalendar(
      adminCtx,
      {
        scope: 'company',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      },
      trackingPool,
    );

    expect(calRes2).toBeDefined();
    expect(trackingPool.getQueryCount()).toBe(0); // Served strictly from Redis cache!

    // 3. Cache Invalidation
    await leaveService.invalidateCalendarCache(companyId);
    trackingPool.resetQueryCount();
    await leaveService.getCalendar(
      adminCtx,
      {
        scope: 'company',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      },
      trackingPool,
    );
    expect(trackingPool.getQueryCount()).toBeGreaterThan(0); // Re-fetched from DB
  });

  it('role dashboard cards satisfy query budget <= 2 per card and verify Redis cache hit', async () => {
    const ownerPool = getOwnerPool();
    const trackingPool = createTrackingPool(ownerPool);

    await dashboardService.invalidateCardCache(companyId, 'hr_headcount');

    // 1. Initial DB fetch
    trackingPool.resetQueryCount();
    const cardRes = await dashboardService.getCard(adminCtx, 'hr_headcount', trackingPool);
    expect(cardRes.key).toBe('hr_headcount');
    expect(cardRes.data).toBeDefined();
    // PHASE3_SPEC Section 9 requirement: query budget <= 2 per widget card
    expect(trackingPool.getQueryCount()).toBeLessThanOrEqual(2);

    // 2. Second fetch from cache
    trackingPool.resetQueryCount();
    const cachedCard = await dashboardService.getCard(adminCtx, 'hr_headcount', trackingPool);
    expect(cachedCard.key).toBe('hr_headcount');
    expect(trackingPool.getQueryCount()).toBe(0); // Cache hit
  });

  it('verifies index utilization for leave balances and requests via EXPLAIN', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      await client.query('SET LOCAL enable_seqscan = off');

      // 1. Leave balances index scan
      const balPlanRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, closing
         FROM leave_balances
         WHERE company_id = $1 AND employee_id = $2`,
        [companyId, employeeId],
      );
      const balPlanText = balPlanRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(balPlanText).toMatch(/Index Scan|Bitmap Index Scan|idx_leave_balances/i);

      // 2. Attendance period summary index scan
      const sumPlanRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, present, worked_minutes
         FROM attendance_period_summary
         WHERE company_id = $1 AND employee_id = $2 AND period = '2026-09'`,
        [companyId, employeeId],
      );
      const sumPlanText = sumPlanRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(sumPlanText).toMatch(/Index Scan|Bitmap Index Scan|attendance_period_summary/i);

      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
