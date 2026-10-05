import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  AttendanceDayService,
  calculateLateMarkPenalty,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 3.2 Integration Suite: Comp-Off, Late-Penalty & Period Summary (P3-INT-02)', () => {
  const dayService = new AttendanceDayService();

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
      requestId: 'test-req-leave-rules',
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
        [generateUuidV7(), companyId, 'compoff.emp@test.internal', 'dummy_hash'],
      );
      const uId = uRes.rows[0]!.id;

      // 2. Create Employee
      const empRes = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, status, doj, search_key)
         VALUES ($1, $2, $3, 'CMP001', 'Charlie', 'Worker', 'cmp001@test.internal', 'active', '2025-01-01', 'charlie worker cmp001')
         ON CONFLICT (company_id, emp_code) DO UPDATE SET first_name = EXCLUDED.first_name, status = 'active'
         RETURNING id`,
        [employeeId, companyId, uId],
      );
      employeeId = empRes.rows[0]!.id;

      // 3. Ensure Default Policy with 240 half day / 480 full day exists
      await client.query(
        `INSERT INTO attendance_policies (
          id, company_id, code, name, geofence_mode, allow_selfie, require_selfie,
          max_gps_accuracy_meters, allowed_sources, grace_minutes, half_day_minutes,
          full_day_minutes, auto_punch_out_hours, created_by, updated_by
        ) VALUES (
          gen_random_uuid(), $1, 'DEFAULT', 'Standard Policy', 'soft', false, false,
          50, ARRAY['mobile', 'web', 'biometric'], 15, 240, 480, '12.0', $2, $2
        ) ON CONFLICT (company_id, code) DO NOTHING`,
        [companyId, adminUserId],
      );
    }, ownerPool);
  });

  it('calculateLateMarkPenalty deterministically calculates penalty days and carryover counts', () => {
    // Under threshold (2 late marks, threshold 3) -> 0 penalty
    const res1 = calculateLateMarkPenalty(2, 3, 0.5);
    expect(res1.penaltyDays).toBe(0);
    expect(res1.remainingLateCount).toBe(2);

    // Exact threshold (3 late marks) -> 0.5 day penalty
    const res2 = calculateLateMarkPenalty(3, 3, 0.5);
    expect(res2.penaltyDays).toBe(0.5);
    expect(res2.remainingLateCount).toBe(0);

    // Multiple thresholds (7 late marks) -> 1.0 day penalty (6 late marks), 1 remaining
    const res3 = calculateLateMarkPenalty(7, 3, 0.5);
    expect(res3.penaltyDays).toBe(1.0);
    expect(res3.remainingLateCount).toBe(1);

    // 0 late marks
    const res4 = calculateLateMarkPenalty(0, 3, 0.5);
    expect(res4.penaltyDays).toBe(0);
    expect(res4.remainingLateCount).toBe(0);
  });

  it('closeDayBatch generates comp-off credit when employee works on a weekly off or holiday', async () => {
    const ownerPool = getOwnerPool();
    const sundayDate = '2026-09-06'; // A Sunday in September 2026 (partition exists)

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Assign roster marking Sunday as weekly off
      const shiftRes = await client.query<{ id: string }>(
        `SELECT id FROM shifts WHERE company_id = $1 LIMIT 1`,
        [companyId],
      );
      const shiftId = shiftRes.rows[0]?.id;

      if (shiftId) {
        await client.query(
          `INSERT INTO rosters (id, company_id, employee_id, work_date, shift_id, is_weekly_off, is_holiday, created_by, updated_by)
           VALUES ($1, $2, $3, $4::date, $5, true, false, $6, $6)
           ON CONFLICT (company_id, employee_id, work_date) DO UPDATE SET is_weekly_off = true`,
          [generateUuidV7(), companyId, employeeId, sundayDate, shiftId, adminUserId],
        );
      }

      // 2. Insert punches on Sunday: 09:00 to 18:00 (9 hours = 540 minutes >= 480 full day)
      const inTime = new Date(`${sundayDate}T09:00:00Z`);
      const outTime = new Date(`${sundayDate}T18:00:00Z`);

      await client.query(
        `INSERT INTO attendance_punches (
          id, company_id, employee_id, work_date, punch_type, punch_time, source, status, created_at
        ) VALUES 
          ($1, $2, $3, $4::date, 'in', $5, 'biometric', 'valid', $5),
          ($6, $2, $3, $4::date, 'out', $7, 'biometric', 'valid', $7)`,
        [generateUuidV7(), companyId, employeeId, sundayDate, inTime, generateUuidV7(), outTime],
      );
    }, ownerPool);

    // Run closeDayBatch for the Sunday date
    const batchResult = await dayService.closeDayBatch(companyId, sundayDate, 100, ownerPool);
    expect(batchResult.totalEmployees).toBeGreaterThanOrEqual(1);

    // Verify comp_off_credits table has the granted credit
    const credits = await dayService.listCompOffCredits(adminCtx, employeeId, ownerPool);
    expect(credits.length).toBeGreaterThanOrEqual(1);

    const sundayCredit = credits.find(c => c.sourceDate === sundayDate);
    expect(sundayCredit).toBeDefined();
    expect(sundayCredit!.sourceType).toBe('weekly_off');
    expect(sundayCredit!.daysGranted).toBe('1.00');
    expect(sundayCredit!.status).toBe('granted');
    expect(sundayCredit!.minutesWorked).toBeGreaterThanOrEqual(480);
  });

  it('allows claiming granted comp-off credit and prevents double claiming', async () => {
    const ownerPool = getOwnerPool();
    const credits = await dayService.listCompOffCredits(adminCtx, employeeId, ownerPool);
    const grantedCredit = credits.find(c => c.status === 'granted');
    expect(grantedCredit).toBeDefined();

    // 1. Claim credit
    const claimRes = await dayService.claimCompOff(adminCtx, grantedCredit!.id, ownerPool);
    expect(claimRes.id).toBe(grantedCredit!.id);
    expect(claimRes.status).toBe('claimed');

    // 2. Attempting to claim again should reject
    await expect(
      dayService.claimCompOff(adminCtx, grantedCredit!.id, ownerPool),
    ).rejects.toThrow(/already claimed/i);
  });

  it('closeDayBatch upserts attendance_period_summary with aggregated monthly figures', async () => {
    const ownerPool = getOwnerPool();

    // Verify attendance_period_summary for 2026-08 was computed
    const summaryRes = await withTenant({ companyId }, async (_tx, client) => {
      return client.query<{
        present: string;
        weekly_off: string;
        worked_minutes: number;
        late_count: number;
      }>(
        `SELECT present, weekly_off, worked_minutes, late_count
         FROM attendance_period_summary
         WHERE company_id = $1 AND employee_id = $2 AND period = '2026-09'`,
        [companyId, employeeId],
      );
    }, ownerPool);

    expect(summaryRes.rows.length).toBe(1);
    const summary = summaryRes.rows[0]!;
    expect(Number(summary.worked_minutes)).toBeGreaterThan(0);
    expect(typeof summary.late_count).toBe('number');
  });
});
