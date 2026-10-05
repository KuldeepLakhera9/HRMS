import type pg from 'pg';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PERMISSIONS,
  UnauthorizedError,
  ValidationError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { AttendanceExceptionsRepository, type AttendanceExceptionItem, type ExceptionSummaryCounts, type CalendarDayViewItem } from './exceptions-repository.js';
import { AttendanceLockService } from './lock-service.js';
import { AttendanceDayService } from './day-service.js';
import { AttendanceDayRepository } from './day-repository.js';
import { AttendancePunchRepository, type EffectivePunchRecord } from './punch-repository.js';
import type { ListExceptionsInput, BulkResolveExceptionsInput } from './exceptions-validation.js';

export interface DayDetailView {
  day: {
    id: string;
    employeeId: string;
    workDate: string;
    status: string;
    shiftId: string | null;
    firstIn: Date | null;
    lastOut: Date | null;
    punchCount: number;
    totalWorkMinutes: number;
    effectiveMinutes: number;
    lateInMinutes: number;
    earlyOutMinutes: number;
    overtimeMinutes: number;
    isRegularized: boolean;
    isLocked: boolean;
  } | null;
  punches: Array<EffectivePunchRecord & { hasLocationData: boolean }>;
  canViewMap: boolean;
}

export class AttendanceExceptionsService {
  private repo: AttendanceExceptionsRepository;
  private lockService: AttendanceLockService;
  private dayService: AttendanceDayService;
  private dayRepo: AttendanceDayRepository;
  private punchRepo: AttendancePunchRepository;
  private auditService: AuditService;

  constructor(
    repo?: AttendanceExceptionsRepository,
    lockService?: AttendanceLockService,
    dayService?: AttendanceDayService,
    dayRepo?: AttendanceDayRepository,
    punchRepo?: AttendancePunchRepository,
    auditService?: AuditService,
  ) {
    this.repo = repo ?? new AttendanceExceptionsRepository();
    this.lockService = lockService ?? new AttendanceLockService();
    this.dayService = dayService ?? new AttendanceDayService();
    this.dayRepo = dayRepo ?? new AttendanceDayRepository();
    this.punchRepo = punchRepo ?? new AttendancePunchRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Lists attendance exceptions with keyset pagination and filtering (P2-DAY-05).
   * Query budget: 1
   */
  async listExceptions(
    ctx: RequestContext,
    filters: ListExceptionsInput,
    poolOverride?: pg.Pool,
  ): Promise<{ items: AttendanceExceptionItem[]; nextCursor: { workDate: string; id: string } | null }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    if (!can(ctx, PERMISSIONS.ATTENDANCE_EXCEPTION_READ)) {
      throw new ForbiddenError('Permission denied: attendance.exception.read required.');
    }

    return this.repo.listExceptions(ctx.companyId, filters, poolOverride);
  }

  /**
   * Retrieves summary counts for the exceptions dashboard cards (P2-DAY-05).
   * Query budget: 1
   */
  async getExceptionSummary(
    ctx: RequestContext,
    startDate?: string,
    endDate?: string,
    poolOverride?: pg.Pool,
  ): Promise<ExceptionSummaryCounts> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    if (!can(ctx, PERMISSIONS.ATTENDANCE_EXCEPTION_READ)) {
      throw new ForbiddenError('Permission denied: attendance.exception.read required.');
    }

    return this.repo.getExceptionSummary(ctx.companyId, startDate, endDate, poolOverride);
  }

  /**
   * Bulk resolves attendance exceptions (P2-DAY-05).
   * Enforces period lock validation, applies updates, triggers day recomputation when needed, and logs audit events.
   * Query budget: <= 5
   */
  async bulkResolveExceptions(
    ctx: RequestContext,
    input: BulkResolveExceptionsInput,
    poolOverride?: pg.Pool,
  ): Promise<{ resolvedCount: number; message: string }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    if (!can(ctx, PERMISSIONS.ATTENDANCE_EXCEPTION_MANAGE)) {
      throw new ForbiddenError('Permission denied: attendance.exception.manage required.');
    }

    // 1. Fetch days to verify they exist and are not locked
    const targetDays = await this.repo.getDaysByIds(ctx.companyId, input.dayIds, poolOverride);
    if (targetDays.length === 0) {
      throw new NotFoundError('No matching attendance day records found.');
    }

    for (const d of targetDays) {
      if (d.isLocked) {
        throw new ConflictError(`Cannot resolve exception for locked date: ${d.workDate}`);
      }
      const isLocked = await this.lockService.isDateLocked(ctx.companyId, d.workDate, poolOverride);
      if (isLocked) {
        throw new ConflictError(`Cannot resolve exception in locked attendance period: ${d.workDate}`);
      }
    }

    const auditUserId =
      ctx.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.userId)
        ? ctx.userId
        : '00000000-0000-0000-0000-000000000000';

    let resolvedCount = 0;

    if (input.action === 'mark_present') {
      resolvedCount = await this.repo.bulkUpdateDays(
        ctx.companyId,
        input.dayIds,
        {
          status: 'present',
          isRegularized: true,
          effectiveMinutes: 480,
          updatedBy: auditUserId,
        },
        poolOverride,
      );
    } else if (input.action === 'excuse') {
      resolvedCount = await this.repo.bulkUpdateDays(
        ctx.companyId,
        input.dayIds,
        {
          isRegularized: true,
          updatedBy: auditUserId,
        },
        poolOverride,
      );
    } else if (input.action === 'regularize') {
      // Recompute day for each target day
      for (const d of targetDays) {
        await this.dayService.recomputeDay(ctx, d.employeeId, d.workDate, poolOverride);
        resolvedCount++;
      }
    }

    // 2. Audit Event
    await this.auditService.recordEvent(
      ctx,
      {
        action: 'attendance.exception.bulk_resolved',
        entity: 'attendance_exception',
        entityId: input.dayIds[0] ?? ctx.companyId,
        after: {
          action: input.action,
          dayCount: input.dayIds.length,
          comments: input.comments ?? null,
          resolvedCount,
        },
        poolOverride,
      },
    );

    return {
      resolvedCount,
      message: `Successfully resolved ${resolvedCount} attendance exception(s).`,
    };
  }

  /**
   * Retrieves month calendar view with aggregate metrics (P2-DAY-06).
   * Query budget: 2
   */
  async getMonthCalendar(
    ctx: RequestContext,
    month: string,
    employeeId?: string,
    poolOverride?: pg.Pool,
  ): Promise<{
    employeeId: string;
    month: string;
    summary: {
      presentDays: number;
      absentDays: number;
      halfDays: number;
      weeklyOffDays: number;
      holidayDays: number;
      exceptionDays: number;
      totalWorkedHours: string;
      overtimeHours: string;
    };
    days: CalendarDayViewItem[];
  }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }

    const targetEmployeeId = employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Employee ID must be provided.');
    }

    if (targetEmployeeId !== ctx.employeeId) {
      if (!can(ctx, PERMISSIONS.ATTENDANCE_DAY_READ)) {
        throw new ForbiddenError('Permission denied: cannot view attendance calendar of other employees.');
      }
    }

    // Compute month boundaries: YYYY-MM
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr ?? '2026', 10);
    const monthNum = parseInt(monthStr ?? '10', 10);
    const startDate = `${month}-01`;
    const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
    const endDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;

    const days = await this.repo.getMonthCalendarDays(ctx.companyId, targetEmployeeId, startDate, endDate, poolOverride);

    let presentDays = 0;
    let absentDays = 0;
    let halfDays = 0;
    let weeklyOffDays = 0;
    let holidayDays = 0;
    let exceptionDays = 0;
    let totalWorkMinutes = 0;
    let totalOvertimeMinutes = 0;

    for (const d of days) {
      if (d.status === 'present') presentDays++;
      else if (d.status === 'absent') absentDays++;
      else if (d.status === 'half_day') halfDays++;
      else if (d.status === 'weekly_off') weeklyOffDays++;
      else if (d.status === 'holiday') holidayDays++;

      if (d.status === 'missing_punch' || d.lateInMinutes > 0 || d.earlyOutMinutes > 0) {
        exceptionDays++;
      }

      totalWorkMinutes += d.totalWorkMinutes;
      totalOvertimeMinutes += d.overtimeMinutes;
    }

    return {
      employeeId: targetEmployeeId,
      month,
      summary: {
        presentDays,
        absentDays,
        halfDays,
        weeklyOffDays,
        holidayDays,
        exceptionDays,
        totalWorkedHours: (totalWorkMinutes / 60).toFixed(1),
        overtimeHours: (totalOvertimeMinutes / 60).toFixed(1),
      },
      days,
    };
  }

  /**
   * Retrieves detailed day view with punches and permission-gated geolocation (P2-DAY-06).
   * Mask coordinates if user lacks `attendance.punch.view_map`.
   * Query budget: 2
   */
  async getDayDetail(
    ctx: RequestContext,
    workDate: string,
    employeeId?: string,
    poolOverride?: pg.Pool,
  ): Promise<DayDetailView> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }

    const targetEmployeeId = employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Employee ID must be specified.');
    }

    if (targetEmployeeId !== ctx.employeeId) {
      if (!can(ctx, PERMISSIONS.ATTENDANCE_DAY_READ)) {
        throw new ForbiddenError('Permission denied: cannot view attendance day detail of other employees.');
      }
    }

    const day = await this.dayRepo.getDay(ctx.companyId, targetEmployeeId, workDate, poolOverride);
    const punches = await this.punchRepo.getEmployeePunchesForDate(
      ctx.companyId,
      targetEmployeeId,
      workDate,
      poolOverride,
    );

    const hasMapPermission =
      can(ctx, PERMISSIONS.ATTENDANCE_LOCATION_DATA_VIEW) ||
      can(ctx, PERMISSIONS.ATTENDANCE_PUNCH_VIEW_MAP);

    if (hasMapPermission && targetEmployeeId !== ctx.employeeId) {
      await this.auditService.recordEvent(ctx, {
        action: 'attendance.location_data.view',
        entity: 'attendance_day',
        entityId: day?.id ?? targetEmployeeId,
        meta: { workDate, employeeId: targetEmployeeId },
        poolOverride,
      }).catch(() => {});
    }

    const mappedPunches = punches.map((p) => {
      const hasCoords = p.latitude !== null && p.longitude !== null;
      return {
        ...p,
        hasLocationData: hasCoords,
        latitude: hasMapPermission ? p.latitude : null,
        longitude: hasMapPermission ? p.longitude : null,
      };
    });

    return {
      day: day
        ? {
            id: day.id,
            employeeId: day.employeeId,
            workDate: day.workDate,
            status: day.status,
            shiftId: day.shiftId,
            firstIn: day.firstIn,
            lastOut: day.lastOut,
            punchCount: day.punchCount,
            totalWorkMinutes: day.totalWorkMinutes,
            effectiveMinutes: day.effectiveMinutes,
            lateInMinutes: day.lateInMinutes,
            earlyOutMinutes: day.earlyOutMinutes,
            overtimeMinutes: day.overtimeMinutes,
            isRegularized: day.isRegularized,
            isLocked: day.isLocked,
          }
        : null,
      punches: mappedPunches,
      canViewMap: hasMapPermission,
    };
  }
}
