import type pg from 'pg';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
  PERMISSIONS,
} from '@hrms/shared';
import { getAppPool, withTenant, type AttendanceDay } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { AttendanceDayRepository } from './day-repository.js';
import { AttendanceLockService } from './lock-service.js';
import { DayContextProvider } from './day-context-provider.js';
import { AttendancePunchRepository } from './punch-repository.js';
import { ShiftService } from './shift-service.js';
import { AttendancePolicyRepository } from './repository.js';
import { computeDay, type DayCalculationResult } from './day-engine.js';

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
    const policyResult = await this.policyRepo.findEffectivePolicy(
      ctx.companyId,
      workDate,
      employeeId,
      undefined,
      undefined,
      poolOverride,
    );
    if (!policyResult) {
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
      policyResult.policy,
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
        shiftId: shiftResolution.shift?.id ?? null,
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
        createdBy: ctx.userId ?? 'system',
        updatedBy: ctx.userId ?? 'system',
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

      // Compute days for this chunk
      const dayInputs = [];

      for (const emp of employees) {
        const effectivePolicyRes = await this.policyRepo.findEffectivePolicy(
          companyId,
          workDate,
          emp.id,
          emp.departmentId,
          emp.locationId,
          poolOverride,
        );
        const policy = effectivePolicyRes ? effectivePolicyRes.policy : fallbackPolicy;

        const punches = await this.punchRepo.getEmployeePunchesForDate(
          companyId,
          emp.id,
          workDate,
          poolOverride,
        );

        const shiftRes = await this.shiftService.resolveShiftAndDate(
          companyId,
          emp.id,
          new Date(workDate),
          'Asia/Kolkata',
          poolOverride,
        );

        const context = await this.contextProvider.getDayContext(
          companyId,
          emp.id,
          workDate,
          poolOverride,
        );

        const calc = computeDay(punches, shiftRes.shift ?? null, policy, context);

        dayInputs.push({
          employeeId: emp.id,
          workDate,
          shiftId: shiftRes.shift?.id ?? null,
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
          createdBy: 'system_close_day',
          updatedBy: 'system_close_day',
        });
      }

      // Batch upsert chunk
      const updatedInChunk = await this.dayRepo.batchUpsertDays(companyId, dayInputs, poolOverride);
      totalUpdated += updatedInChunk;
    }

    return { totalEmployees, totalUpdated };
  }
}
