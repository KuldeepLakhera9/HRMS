import type pg from 'pg';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
  PERMISSIONS,
} from '@hrms/shared';
import { DateTime } from 'luxon';
import { getAppPool, withTenant, generateUuidV7, type AttendanceDay } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { AttendanceDayRepository } from './day-repository.js';
import { AttendanceLockService } from './lock-service.js';
import { DayContextProvider } from './day-context-provider.js';
import { AttendancePunchRepository, type EffectivePunchRecord } from './punch-repository.js';
import { ShiftService } from './shift-service.js';
import { AttendancePolicyRepository } from './repository.js';
import { computeDay, type DayCalculationResult, type DayContext } from './day-engine.js';
import { HolidayService } from '../leave/holiday-service.js';
import { isWeeklyOffDate } from '../leave/compute-leave-days.js';

export interface RecomputeDayResult {
  day: AttendanceDay;
  recomputed: boolean;
  sourceHash: string;
  calculation: DayCalculationResult;
}

export class AttendanceDayService {
  private dayRepo: AttendanceDayRepository;
  private lockService: AttendanceLockService;
  private contextProvider: DayContextProvider;
  private punchRepo: AttendancePunchRepository;
  private shiftService: ShiftService;
  private policyRepo: AttendancePolicyRepository;
  private auditService: AuditService;

  constructor(
    dayRepo?: AttendanceDayRepository,
    lockService?: AttendanceLockService,
    contextProvider?: DayContextProvider,
    punchRepo?: AttendancePunchRepository,
    shiftService?: ShiftService,
    policyRepo?: AttendancePolicyRepository,
    auditService?: AuditService,
  ) {
    this.dayRepo = dayRepo ?? new AttendanceDayRepository();
    this.lockService = lockService ?? new AttendanceLockService();
    this.contextProvider = contextProvider ?? new DayContextProvider();
    this.punchRepo = punchRepo ?? new AttendancePunchRepository();
    this.shiftService = shiftService ?? new ShiftService();
    this.policyRepo = policyRepo ?? new AttendancePolicyRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Recomputes an employee's attendance day.
   * Asserts locked-day immutability and skips DB write if source_hash is unchanged.
   * Query budget: 5
   */
  async recomputeDay(
    ctx: RequestContext,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<RecomputeDayResult> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to recompute attendance day.');
    }

    if (!can(ctx, PERMISSIONS.ATTENDANCE_LOCK_MANAGE) && !can(ctx, PERMISSIONS.ATTENDANCE_DAY_RECALCULATE)) {
      if (ctx.employeeId !== employeeId) {
        throw new ForbiddenError('You do not have permission to recompute attendance day for this employee.');
      }
    }

    // 1. Immutability Check: Assert period is not locked
    await this.lockService.assertPeriodUnlocked(ctx.companyId, workDate, poolOverride);

    // 2. Fetch effective punches for this date
    const punches = await this.punchRepo.getEmployeePunchesForDate(
      ctx.companyId,
      employeeId,
      workDate,
      poolOverride,
    );

    // 3. Resolve Policy
    let policy = (
      await this.policyRepo.findEffectivePolicy(
        ctx.companyId,
        workDate,
        employeeId,
        undefined,
        undefined,
        poolOverride,
      )
    )?.policy;

    if (!policy) {
      policy =
        (await this.policyRepo.getPolicyByCode(ctx.companyId, 'DEFAULT', poolOverride)) ??
        (await this.policyRepo.listPolicies(ctx.companyId, poolOverride))[0];
    }

    if (!policy) {
      throw new NotFoundError('AttendancePolicy for date', workDate);
    }

    // 4. Resolve Shift
    const shiftResolution = await this.shiftService.resolveShiftAndDate(
      ctx.companyId,
      employeeId,
      new Date(workDate),
      'Asia/Kolkata',
      poolOverride,
    );

    // 5. Resolve DayContext (Weekly off + approved OD/WFH)
    const context = await this.contextProvider.getDayContext(
      ctx.companyId,
      employeeId,
      workDate,
      poolOverride,
    );

    // 6. Run Pure Engine
    const calculation = computeDay(
      punches,
      shiftResolution.shift ?? null,
      policy,
      context,
    );

    // 7. Check Existing Record for Source Hash Idempotency
    const existing = await this.dayRepo.getDay(ctx.companyId, employeeId, workDate, poolOverride);
    if (existing && existing.sourceHash === calculation.sourceHash) {
      return {
        day: existing,
        recomputed: false,
        sourceHash: calculation.sourceHash,
        calculation,
      };
    }

    // 8. Upsert Record
    const upserted = await this.dayRepo.upsertDay(
      ctx.companyId,
      {
        employeeId,
        workDate,
        shiftId:
          shiftResolution.shift?.id &&
          shiftResolution.shift.id !== '00000000-0000-0000-0000-000000000001'
            ? shiftResolution.shift.id
            : null,
        firstIn: calculation.firstIn,
        lastOut: calculation.lastOut,
        punchCount: calculation.punchCount,
        totalWorkMinutes: calculation.totalWorkMinutes,
        effectiveMinutes: calculation.effectiveMinutes,
        lateInMinutes: calculation.lateInMinutes,
        earlyOutMinutes: calculation.earlyOutMinutes,
        overtimeMinutes: calculation.overtimeMinutes,
        status: calculation.status,
        isRegularized: existing ? existing.isRegularized : false,
        isLocked: false,
        ruleVersion: calculation.ruleVersion,
        sourceHash: calculation.sourceHash,
        lopDays: calculation.lopDays.toFixed(2),
        leavePortion: calculation.leavePortion.toFixed(2),
        holidayId: calculation.holidayId,
        createdBy: ctx.userId ?? '00000000-0000-0000-0000-000000000001',
        updatedBy: ctx.userId ?? '00000000-0000-0000-0000-000000000001',
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.day.recomputed',
      entity: 'attendance_days',
      entityId: upserted.id,
      after: {
        employeeId,
        workDate,
        status: calculation.status,
        sourceHash: calculation.sourceHash,
      },
    });

    return {
      day: upserted,
      recomputed: true,
      sourceHash: calculation.sourceHash,
      calculation,
    };
  }

  /**
   * Batch processes attendance day closure for all active employees in chunks of 500.
   * Query budget: chunked batch
   */
  async closeDayBatch(
    companyId: string,
    workDate: string,
    chunkSize = 500,
    poolOverride?: pg.Pool,
  ): Promise<{ totalEmployees: number; totalUpdated: number }> {
    const pool = poolOverride ?? getAppPool();

    // Check lock
    const isLocked = await this.lockService.isDateLocked(companyId, workDate, poolOverride);
    if (isLocked) {
      throw new ValidationError(`Cannot close attendance day: period is locked.`);
    }

    let cursorId: string | null = null;
    let totalEmployees = 0;
    let totalUpdated = 0;

    // Resolve company policies for fallback
    const policies = await this.policyRepo.listPolicies(companyId, poolOverride);
    const fallbackPolicy = policies[0];
    if (!fallbackPolicy) {
      throw new NotFoundError('Company Attendance Policy', companyId);
    }

    // Resolve acting user for audit columns
    const systemUserId =
      (await withTenant({ companyId }, async (_tx, client) => {
        const res = await client.query<{ id: string }>('SELECT id FROM users WHERE company_id = $1 LIMIT 1', [companyId]);
        return res.rows[0]?.id;
      }, pool)) ?? '00000000-0000-0000-0000-000000000001';

    // Resolve default shift once for fallback
    const defaultShiftRecord = await withTenant({ companyId }, async (_tx, client) => {
      const sRes = await client.query<{
        id: string;
        company_id: string;
        code: string;
        name: string;
        start_time: string;
        end_time: string;
        crosses_midnight: boolean;
        grace_minutes: number;
        break_minutes: number;
        work_hours: string;
        weekly_off_rules: Array<{ day: number; weeks?: number[] }>;
      }>(
        `SELECT id, company_id, code, name, start_time, end_time, crosses_midnight, grace_minutes, break_minutes, work_hours, weekly_off_rules
         FROM shifts
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );
      if (sRes.rows[0]) {
        const r = sRes.rows[0];
        return {
          id: r.id,
          companyId: r.company_id,
          code: r.code,
          name: r.name,
          startTime: r.start_time,
          endTime: r.end_time,
          crossesMidnight: r.crosses_midnight,
          graceMinutes: r.grace_minutes,
          breakMinutes: r.break_minutes,
          workHours: r.work_hours,
          weeklyOffRules: r.weekly_off_rules ?? [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    }, pool);

    const holidayService = new HolidayService();

    while (true) {
      // Keyset pagination of active employees
      const employees = await withTenant({ companyId }, async (_tx, client) => {
        let sqlStr = `
          SELECT id, location_id as "locationId", department_id as "departmentId"
          FROM employees
          WHERE company_id = $1 AND deleted_at IS NULL AND status = 'active'
        `;
        const params: unknown[] = [companyId];
        if (cursorId) {
          sqlStr += ` AND id > $2`;
          params.push(cursorId);
        }
        sqlStr += ` ORDER BY id ASC LIMIT $${params.length + 1}`;
        params.push(chunkSize);

        const res = await client.query<{ id: string; locationId: string | null; departmentId: string | null }>(sqlStr, params);
        return res.rows;
      }, pool);

      if (employees.length === 0) break;
      totalEmployees += employees.length;
      cursorId = employees[employees.length - 1]!.id;

      const empIds = employees.map(e => e.id);

      // 1. Batch fetch punches for this chunk
      const punchesRes = await withTenant({ companyId }, async (_tx, client) => {
        return client.query<{
          employee_id: string;
          id: string;
          punch_time: Date;
          punch_type: 'in' | 'out' | 'auto_out';
          source: 'mobile' | 'web' | 'biometric' | 'qr';
          work_date: string;
        }>(
          `SELECT employee_id, id, punch_time, punch_type, source, work_date
           FROM attendance_punches
           WHERE company_id = $1 AND employee_id = ANY($2::uuid[]) AND work_date = $3::date
           ORDER BY punch_time ASC`,
          [companyId, empIds, workDate]
        );
      }, pool);

      const punchesByEmp = new Map<string, EffectivePunchRecord[]>();
      for (const p of punchesRes.rows) {
        let list = punchesByEmp.get(p.employee_id);
        if (!list) {
          list = [];
          punchesByEmp.set(p.employee_id, list);
        }
        list.push({
          id: p.id,
          companyId,
          employeeId: p.employee_id,
          punchTime: p.punch_time,
          punchType: p.punch_type,
          source: p.source,
          workDate: p.work_date,
          shiftId: null,
          locationId: null,
          latitude: null,
          longitude: null,
          gpsAccuracy: null,
          isInsideGeofence: true,
          distanceMeters: null,
          selfieFileId: null,
          deviceId: null,
          deviceModel: null,
          isMockLocation: false,
          status: 'valid',
          reasonCode: 'PUNCH_SUCCESS',
          flagReasons: [],
          idempotencyKey: null,
          createdAt: p.punch_time,
          effectiveStatus: 'valid',
          reviewId: null,
          workflowRequestId: null,
          reviewerId: null,
          reviewComments: null,
          reviewedAt: null,
        });
      }

      // 2. Batch fetch rosters for this chunk
      const rostersRes = await withTenant({ companyId }, async (_tx, client) => {
        return client.query<{
          employee_id: string;
          shift_id: string;
          is_weekly_off: boolean;
          is_holiday: boolean;
          code: string;
          name: string;
          start_time: string;
          end_time: string;
          crosses_midnight: boolean;
          grace_minutes: number;
          break_minutes: number;
          work_hours: string;
        }>(
          `SELECT r.employee_id, r.shift_id, r.is_weekly_off, r.is_holiday,
                  s.code, s.name, s.start_time, s.end_time, s.crosses_midnight,
                  s.grace_minutes, s.break_minutes, s.work_hours
           FROM rosters r
           JOIN shifts s ON s.company_id = r.company_id AND s.id = r.shift_id
           WHERE r.company_id = $1 AND r.employee_id = ANY($2::uuid[]) AND r.work_date = $3::date AND r.deleted_at IS NULL`,
          [companyId, empIds, workDate]
        );
      }, pool);
      const rostersByEmp = new Map(rostersRes.rows.map(r => [r.employee_id, r]));

      // 3. Batch fetch approved leaves for this chunk
      const leavesRes = await withTenant({ companyId }, async (_tx, client) => {
        return client.query<{
          employee_id: string;
          days: string;
          is_paid: boolean;
        }>(
          `SELECT employee_id, days, is_paid
           FROM leave_request_days
           WHERE company_id = $1 AND employee_id = ANY($2::uuid[]) AND leave_date = $3::date AND status = 'approved'`,
          [companyId, empIds, workDate]
        );
      }, pool);
      const leavesByEmp = new Map(leavesRes.rows.map(l => [l.employee_id, l]));

      // 4. Batch fetch holidays per unique location in chunk
      const uniqueLocs = Array.from(new Set(employees.map(e => e.locationId)));
      const holidaysByLoc = new Map<string, Array<{ id: string; name: string }>>();
      for (const locId of uniqueLocs) {
        const hList = await holidayService.resolveHolidaysForEmployee(
          companyId,
          locId,
          workDate,
          workDate,
          pool
        );
        holidaysByLoc.set(locId ?? 'company', hList);
      }

      const dt = DateTime.fromISO(workDate);
      const defaultIsWeeklyOff = dt.isValid && defaultShiftRecord?.weeklyOffRules
        ? isWeeklyOffDate(dt, defaultShiftRecord.weeklyOffRules)
        : false;

      // Compute days for this chunk in memory
      const dayInputs = [];
      const compOffCreditsToInsert: Array<{
        id: string;
        companyId: string;
        employeeId: string;
        sourceDate: string;
        sourceType: string;
        minutesWorked: number;
        daysGranted: string;
        expiresOn: string;
      }> = [];

      for (const emp of employees) {
        const punches = punchesByEmp.get(emp.id) ?? [];
        const roster = rostersByEmp.get(emp.id);
        const leave = leavesByEmp.get(emp.id);
        const holidays = holidaysByLoc.get(emp.locationId ?? 'company') ?? [];

        const shift = roster
          ? {
              id: roster.shift_id,
              companyId,
              code: roster.code,
              name: roster.name,
              startTime: roster.start_time,
              endTime: roster.end_time,
              crossesMidnight: roster.crosses_midnight,
              graceMinutes: roster.grace_minutes,
              breakMinutes: roster.break_minutes,
              workHours: roster.work_hours,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : defaultShiftRecord;

        const isHoliday = roster ? Boolean(roster.is_holiday) : holidays.length > 0;
        const isWeeklyOff = roster ? Boolean(roster.is_weekly_off) : defaultIsWeeklyOff;
        const holidayId = holidays[0]?.id ?? null;

        const context: DayContext = {
          isWeeklyOff,
          isHoliday,
          holidayId,
          isApprovedOD: false,
          isApprovedWFH: false,
          leavePortion: leave ? parseFloat(leave.days) : 0,
          isPaidLeave: leave ? leave.is_paid : true,
        };

        const calc = computeDay(punches, shift, fallbackPolicy, context);

        const validShiftId = shift?.id && shift.id !== '00000000-0000-0000-0000-000000000001' ? shift.id : null;

        dayInputs.push({
          employeeId: emp.id,
          workDate,
          shiftId: validShiftId,
          firstIn: calc.firstIn,
          lastOut: calc.lastOut,
          punchCount: calc.punchCount,
          totalWorkMinutes: calc.totalWorkMinutes,
          effectiveMinutes: calc.effectiveMinutes,
          lateInMinutes: calc.lateInMinutes,
          earlyOutMinutes: calc.earlyOutMinutes,
          overtimeMinutes: calc.overtimeMinutes,
          status: calc.status,
          isRegularized: false,
          isLocked: false,
          ruleVersion: calc.ruleVersion,
          sourceHash: calc.sourceHash,
          lopDays: calc.lopDays.toFixed(2),
          leavePortion: calc.leavePortion.toFixed(2),
          holidayId: calc.holidayId,
          createdBy: systemUserId,
          updatedBy: systemUserId,
        });

        // Comp-off generation (P3-INT-02): If worked on weekly off or holiday
        if ((context.isWeeklyOff || context.isHoliday) && calc.effectiveMinutes >= fallbackPolicy.halfDayMinutes) {
          const daysGranted = calc.effectiveMinutes >= fallbackPolicy.fullDayMinutes ? '1.00' : '0.50';
          const sourceType = context.isWeeklyOff ? 'weekly_off' : 'holiday';
          const expiresOn = DateTime.fromISO(workDate).plus({ days: 90 }).toISODate()!;
          compOffCreditsToInsert.push({
            id: generateUuidV7(),
            companyId,
            employeeId: emp.id,
            sourceDate: workDate,
            sourceType,
            minutesWorked: calc.effectiveMinutes,
            daysGranted,
            expiresOn,
          });
        }
      }

      // Batch insert comp-off credits if any
      if (compOffCreditsToInsert.length > 0) {
        await withTenant({ companyId }, async (_tx, client) => {
          for (const c of compOffCreditsToInsert) {
            await client.query(
              `INSERT INTO comp_off_credits (
                id, company_id, employee_id, source_date, source_type,
                minutes_worked, days_granted, expires_on, status,
                created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'granted', now(), now())
              ON CONFLICT (company_id, employee_id, source_date, source_type)
              DO NOTHING`,
              [c.id, c.companyId, c.employeeId, c.sourceDate, c.sourceType, c.minutesWorked, c.daysGranted, c.expiresOn]
            );
          }
        }, pool);
      }

      // Batch upsert chunk
      const updatedInChunk = await this.dayRepo.batchUpsertDays(companyId, dayInputs, poolOverride);
      totalUpdated += updatedInChunk;

      // Upsert attendance_period_summary for each employee in chunk (P3-INT-02)
      const periodKey = workDate.slice(0, 7); // 'YYYY-MM'
      const startOfMonth = `${periodKey}-01`;
      const endOfMonth = DateTime.fromISO(startOfMonth).endOf('month').toISODate()!;

      if (empIds.length > 0) {
        await withTenant({ companyId }, async (_tx, client) => {
          await client.query(
            `INSERT INTO attendance_period_summary (
              id, company_id, employee_id, period,
              present, absent, half_days, late_count, early_exit_count,
              weekly_off, holidays, leave_days, od_days, wfh_days,
              worked_minutes, overtime_minutes, lop_days, computed_at
            )
            SELECT
              gen_random_uuid(), $1, employee_id, $2,
              COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN late_in_minutes > 0 THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN early_out_minutes > 0 THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN status = 'weekly_off' THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN status = 'holiday' THEN 1 ELSE 0 END), 0),
              COALESCE(SUM(leave_portion::numeric), 0),
              0.00,
              0.00,
              COALESCE(SUM(total_work_minutes), 0),
              COALESCE(SUM(overtime_minutes), 0),
              COALESCE(SUM(lop_days::numeric), 0),
              NOW()
            FROM attendance_days
            WHERE company_id = $1
              AND employee_id = ANY($3::uuid[])
              AND work_date >= $4::date
              AND work_date <= $5::date
              AND deleted_at IS NULL
            GROUP BY company_id, employee_id
            ON CONFLICT (company_id, employee_id, period)
            DO UPDATE SET
              present = EXCLUDED.present,
              absent = EXCLUDED.absent,
              half_days = EXCLUDED.half_days,
              late_count = EXCLUDED.late_count,
              early_exit_count = EXCLUDED.early_exit_count,
              weekly_off = EXCLUDED.weekly_off,
              holidays = EXCLUDED.holidays,
              leave_days = EXCLUDED.leave_days,
              od_days = EXCLUDED.od_days,
              wfh_days = EXCLUDED.wfh_days,
              worked_minutes = EXCLUDED.worked_minutes,
              overtime_minutes = EXCLUDED.overtime_minutes,
              lop_days = EXCLUDED.lop_days,
              computed_at = NOW()`,
            [companyId, periodKey, empIds, startOfMonth, endOfMonth],
          );
        }, pool);
      }
    }

    return { totalEmployees, totalUpdated };
  }

  /**
   * Lists comp-off credits for an employee.
   */
  async listCompOffCredits(
    ctx: RequestContext,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<Array<{
    id: string;
    companyId: string;
    employeeId: string;
    sourceDate: string;
    sourceType: string;
    minutesWorked: number;
    daysGranted: string;
    expiresOn: string;
    status: string;
  }>> {
    const pool = poolOverride ?? getAppPool();
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{
        id: string;
        companyId: string;
        employeeId: string;
        sourceDate: string;
        sourceType: string;
        minutesWorked: number;
        daysGranted: string;
        expiresOn: string;
        status: string;
      }>(
        `SELECT 
          id, company_id AS "companyId", employee_id AS "employeeId",
          TO_CHAR(source_date, 'YYYY-MM-DD') AS "sourceDate",
          source_type AS "sourceType", minutes_worked AS "minutesWorked",
          days_granted::text AS "daysGranted",
          TO_CHAR(expires_on, 'YYYY-MM-DD') AS "expiresOn",
          status
        FROM comp_off_credits
        WHERE company_id = $1 AND employee_id = $2
        ORDER BY source_date DESC`,
        [ctx.companyId, employeeId]
      );
      return res.rows;
    }, pool);
  }

  /**
   * Claims a granted comp-off credit for leave application.
   */
  async claimCompOff(
    ctx: RequestContext,
    compOffId: string,
    poolOverride?: pg.Pool,
  ): Promise<{
    id: string;
    daysGranted: string;
    status: string;
  }> {
    const pool = poolOverride ?? getAppPool();
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{
        id: string;
        days_granted: string;
        status: string;
        expires_on: Date;
      }>(
        `SELECT id, days_granted::text, status, expires_on
         FROM comp_off_credits
         WHERE company_id = $1 AND id = $2
         FOR UPDATE`,
        [ctx.companyId, compOffId]
      );

      const record = res.rows[0];
      if (!record) {
        throw new NotFoundError('Comp-off credit', compOffId);
      }

      if (record.status !== 'granted') {
        throw new ValidationError(`Comp-off credit is already ${record.status}`);
      }

      const today = new Date();
      if (new Date(record.expires_on) < today) {
        throw new ValidationError('Comp-off credit has expired');
      }

      const updateRes = await client.query<{
        id: string;
        days_granted: string;
        status: string;
      }>(
        `UPDATE comp_off_credits
         SET status = 'claimed', updated_at = NOW()
         WHERE company_id = $1 AND id = $2
         RETURNING id, days_granted::text, status`,
        [ctx.companyId, compOffId]
      );

      return {
        id: updateRes.rows[0]!.id,
        daysGranted: updateRes.rows[0]!.days_granted,
        status: updateRes.rows[0]!.status,
      };
    }, pool);
  }
}

/**
 * Calculates late-mark penalties based on threshold rules.
 * E.g., for every 3 late marks in a month, 0.5 day LOP/leave deduction is assessed.
 */
export function calculateLateMarkPenalty(
  lateCount: number,
  lateThreshold = 3,
  penaltyPerThreshold = 0.5,
): { penaltyDays: number; remainingLateCount: number } {
  if (lateCount < lateThreshold || lateThreshold <= 0) {
    return { penaltyDays: 0, remainingLateCount: Math.max(0, lateCount) };
  }
  const instances = Math.floor(lateCount / lateThreshold);
  const penaltyDays = instances * penaltyPerThreshold;
  const remainingLateCount = lateCount % lateThreshold;
  return { penaltyDays, remainingLateCount };
}

