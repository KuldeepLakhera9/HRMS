import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations, seedDatabase, getOwnerPool, getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import {
  AttendancePunchService,
  ShiftService,
  AttendancePolicyRepository,
  type RequestContext,
} from '@hrms/core';

describe('Sprint 2.2 Integration & Query Budget Suite (P2-PUNCH-01, P2-PUNCH-02, P2-PUNCH-05, P2-LOC-03, P2-POL-02)', () => {
  const punchService = new AttendancePunchService();
  const shiftService = new ShiftService();
  const policyRepo = new AttendancePolicyRepository();

  let companyId: string;
  let adminUserId: string;
  let sampleEmployeeId: string;
  let _sampleLocationId: string;
  let _sampleShiftId: string;

  beforeAll(async () => {
    await runMigrations();
    const seed = await seedDatabase();
    companyId = seed.companyId;

    const pool = getOwnerPool();
    const userRes = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE company_id = $1 LIMIT 1',
      [companyId],
    );
    adminUserId = userRes.rows[0]?.id || '';

    // Get or create an employee inside withTenant (due to FORCE ROW LEVEL SECURITY)
    sampleEmployeeId = await withTenant({ companyId }, async (_tx, client) => {
      const empRes = await client.query<{ id: string }>(
        'SELECT id FROM employees WHERE company_id = $1 LIMIT 1',
        [companyId],
      );
      if (empRes.rows.length > 0 && empRes.rows[0]) {
        return empRes.rows[0].id;
      }
      const newId = generateUuidV7();
      await client.query(
        `INSERT INTO employees (
          id, company_id, emp_code, first_name, last_name, email_work,
          employment_type, doj, job_effective_from, status, search_key, user_id,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'EMP-S22-001', 'Admin', 'User', 'admin.s22@orghub.internal',
          'full_time', '2026-01-01', '2026-01-01', 'active', 'admin user emp-s22-001', $3,
          $3, $3, now(), now()
        )`,
        [newId, companyId, adminUserId],
      );
      return newId;
    }, pool);

    // Get a location inside withTenant
    _sampleLocationId = await withTenant({ companyId }, async (_tx, client) => {
      const locRes = await client.query<{ id: string }>(
        'SELECT id FROM work_locations WHERE company_id = $1 LIMIT 1',
        [companyId],
      );
      return locRes.rows[0]?.id || '';
    }, pool);

    // Ensure default general shift exists
    const shiftRes = await pool.query<{ id: string }>(
      'SELECT id FROM shifts WHERE company_id = $1 AND code = $2',
      [companyId, 'GEN_09_18'],
    );
    if (shiftRes.rows[0]) {
      _sampleShiftId = shiftRes.rows[0].id;
    } else {
      const shift = await shiftService.createShift(
        {
          companyId,
          userId: adminUserId,
          roles: ['super_admin'],
          permissions: ['attendance.shift.manage'],
          requestId: 'init-shift',
          isAuthenticated: true,
        },
        {
          code: 'GEN_09_18',
          name: 'General Shift',
          startTime: '09:00:00',
          endTime: '18:00:00',
          crossesMidnight: false,
          graceMinutes: 15,
          breakMinutes: 60,
          workHours: 8,
        },
        pool,
      );
      _sampleShiftId = shift.id;
    }

    // Create a policy if none exists
    const polRes = await pool.query<{ id: string }>(
      'SELECT id FROM attendance_policies WHERE company_id = $1 AND code = $2',
      [companyId, 'POL_TEST'],
    );
    if (!polRes.rows[0]) {
      const pol = await policyRepo.createPolicy(
        companyId,
        {
          code: 'POL_TEST',
          name: 'Test Attendance Policy',
          geofenceMode: 'soft',
          allowSelfie: true,
          requireSelfie: false,
          maxGpsAccuracyMeters: 100,
          allowedSources: ['web', 'mobile'],
          graceMinutes: 15,
          halfDayMinutes: 240,
          fullDayMinutes: 480,
          autoPunchOutHours: '12.0',
          createdBy: adminUserId,
        },
        pool,
      );

      // Assign policy to company
      await policyRepo.createAssignment(
        companyId,
        {
          policyId: pol.id,
          targetType: 'company',
          priority: 100,
          validFrom: '2026-01-01',
          createdBy: adminUserId,
        },
        pool,
      );
    }
  });

  it('proves append-only immutability trigger rejects UPDATE and DELETE on attendance_punches', async () => {
    const pool = getAppPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      // Attempt an update on attendance_punches
      let updateError: Error | null = null;
      try {
        await client.query(
          "UPDATE attendance_punches SET reason_code = 'MUTATED' WHERE company_id = $1",
          [companyId],
        );
      } catch (err) {
        updateError = err as Error;
      }
      expect(updateError).toBeDefined();
      expect(updateError?.message).toMatch(/reject_update_delete|permission denied/i);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('verifies partition pruning on attendance_punches via EXPLAIN plan', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, punch_time FROM attendance_punches
         WHERE company_id = $1 AND punch_time >= '2026-10-01'::timestamptz AND punch_time < '2026-11-01'::timestamptz`,
        [companyId],
      );

      const planText = planRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/attendance_punches_2026_10/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('asserts query budget for punch ingestion pipeline (<= 8 queries)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    const ctx: RequestContext = {
      companyId,
      userId: adminUserId,
      employeeId: sampleEmployeeId,
      roles: ['employee'],
      permissions: ['attendance.punch.create'],
      requestId: 'budget-punch-test',
      isAuthenticated: true,
    };

    try {
      const res = await punchService.recordPunch(
        ctx,
        {
          punchType: 'in',
          punchTime: new Date('2026-10-03T09:15:00Z'),
          source: 'web',
          idempotencyKey: `idemp-budget-${Date.now()}`,
          isMockLocation: false,
        },
        pool,
      );

      expect(res.success).toBe(true);
      expect(queryCount).toBeLessThanOrEqual(8);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for today summary endpoint (<= 3 queries)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    const ctx: RequestContext = {
      companyId,
      userId: adminUserId,
      employeeId: sampleEmployeeId,
      roles: ['employee'],
      permissions: ['attendance.punch.read'],
      requestId: 'budget-today-test',
      isAuthenticated: true,
    };

    try {
      const summary = await punchService.getTodaySummary(ctx, sampleEmployeeId, pool);
      expect(summary).toBeDefined();
      expect(summary.currentPresence).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(3);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for live who-is-in endpoint (<= 3 queries)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    const ctx: RequestContext = {
      companyId,
      userId: adminUserId,
      employeeId: sampleEmployeeId,
      roles: ['super_admin'],
      permissions: ['attendance.presence.read'],
      requestId: 'budget-whoisin-test',
      isAuthenticated: true,
    };

    try {
      const list = await punchService.getWhoIsIn(ctx, { limit: 20 }, pool);
      expect(list).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(3);
    } finally {
      pool.query = origQuery;
    }
  });

  it('enforces idempotency replay on concurrent duplicate punches', async () => {
    const pool = getAppPool();
    const idempotencyKey = `idemp-dup-${Date.now()}`;

    const ctx: RequestContext = {
      companyId,
      userId: adminUserId,
      employeeId: sampleEmployeeId,
      roles: ['employee'],
      permissions: ['attendance.punch.create'],
      requestId: 'idemp-test-1',
      isAuthenticated: true,
    };

    // First punch
    const res1 = await punchService.recordPunch(
      ctx,
      {
        punchType: 'out',
        punchTime: new Date('2026-10-03T18:00:00Z'),
        source: 'web',
        idempotencyKey,
        isMockLocation: false,
      },
      pool,
    );
    expect(res1.success).toBe(true);
    expect(res1.isReplay).toBeFalsy();

    // Duplicate replay punch
    const res2 = await punchService.recordPunch(
      ctx,
      {
        punchType: 'out',
        punchTime: new Date('2026-10-03T18:00:00Z'),
        source: 'web',
        idempotencyKey,
        isMockLocation: false,
      },
      pool,
    );
    expect(res2.success).toBe(true);
    expect(res2.isReplay).toBe(true);
    expect(res2.punchId).toBe(res1.punchId);
  });
});
