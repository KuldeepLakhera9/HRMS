import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import { getAppPool, withTenant, generateUuidV7, attendancePeriodLocks, type AttendancePeriodLock } from '@hrms/db';
import { eq, and, sql, isNull } from 'drizzle-orm';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';

export interface LockPeriodInput {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  reason: string;
}

export interface UnlockPeriodInput {
  periodStart: string;
  periodEnd: string;
  reason: string;
}

export class AttendanceLockService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Locks an attendance period, preventing recomputation or modification.
   * Requires permission: attendance.lock.manage.
   * Query budget: 2
   */
  async lockPeriod(
    ctx: RequestContext,
    input: LockPeriodInput,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePeriodLock> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    if (!can(ctx, PERMISSIONS.ATTENDANCE_LOCK_MANAGE)) {
      throw new ForbiddenError('Permission denied: attendance.lock.manage required to lock period.');
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('A mandatory audit reason is required to lock an attendance period.');
    }

    const pool = poolOverride ?? getAppPool();
    const id = generateUuidV7();

    const lock = await withTenant({ companyId: ctx.companyId }, async tx => {
      const existing = await tx
        .select()
        .from(attendancePeriodLocks)
        .where(
          and(
            eq(attendancePeriodLocks.companyId, ctx.companyId),
            eq(attendancePeriodLocks.periodStart, input.periodStart),
            eq(attendancePeriodLocks.periodEnd, input.periodEnd),
            isNull(attendancePeriodLocks.deletedAt),
          ),
        )
        .limit(1);

      if (existing[0]) {
        const rows = await tx
          .update(attendancePeriodLocks)
          .set({
            isLocked: true,
            lockedBy: ctx.userId ?? id,
            lockedAt: new Date(),
            unlockedBy: null,
            unlockedAt: null,
            reason: input.reason,
            updatedBy: ctx.userId ?? id,
            updatedAt: new Date(),
          })
          .where(and(eq(attendancePeriodLocks.companyId, ctx.companyId), eq(attendancePeriodLocks.id, existing[0].id)))
          .returning();
        return rows[0]!;
      }

      const rows = await tx
        .insert(attendancePeriodLocks)
        .values({
          id,
          companyId: ctx.companyId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          isLocked: true,
          lockedBy: ctx.userId ?? id,
          lockedAt: new Date(),
          reason: input.reason,
          createdBy: ctx.userId ?? id,
          updatedBy: ctx.userId ?? id,
        })
        .returning();

      return rows[0]!;
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.period.lock',
      entity: 'attendance_period_locks',
      entityId: lock.id,
      after: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        isLocked: true,
        reason: input.reason,
      },
    });

    return lock;
  }

  /**
   * Unlocks an attendance period with mandatory audit trail.
   * Requires permission: attendance.lock.manage.
   */
  async unlockPeriod(
    ctx: RequestContext,
    input: UnlockPeriodInput,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePeriodLock> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    if (!can(ctx, PERMISSIONS.ATTENDANCE_LOCK_MANAGE)) {
      throw new ForbiddenError('Permission denied: attendance.lock.manage required to unlock period.');
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('A mandatory audit reason is required to unlock an attendance period.');
    }

    const pool = poolOverride ?? getAppPool();

    const lock = await withTenant({ companyId: ctx.companyId }, async tx => {
      const rows = await tx
        .update(attendancePeriodLocks)
        .set({
          isLocked: false,
          unlockedBy: ctx.userId ?? undefined,
          unlockedAt: new Date(),
          reason: input.reason,
          updatedBy: ctx.userId ?? undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendancePeriodLocks.companyId, ctx.companyId),
            eq(attendancePeriodLocks.periodStart, input.periodStart),
            eq(attendancePeriodLocks.periodEnd, input.periodEnd),
            isNull(attendancePeriodLocks.deletedAt),
          ),
        )
        .returning();

      return rows[0];
    }, pool);

    if (!lock) {
      throw new NotFoundError('Attendance Period Lock', `${input.periodStart} to ${input.periodEnd}`);
    }

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.period.unlock',
      entity: 'attendance_period_locks',
      entityId: lock.id,
      after: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        isLocked: false,
        reason: input.reason,
      },
    });

    return lock;
  }

  /**
   * Checks whether a specific work date is locked.
   * Query budget: 1
   */
  async isDateLocked(
    companyId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .select({ id: attendancePeriodLocks.id })
        .from(attendancePeriodLocks)
        .where(
          and(
            eq(attendancePeriodLocks.companyId, companyId),
            eq(attendancePeriodLocks.isLocked, true),
            sql`${workDate}::date BETWEEN ${attendancePeriodLocks.periodStart} AND ${attendancePeriodLocks.periodEnd}`,
            isNull(attendancePeriodLocks.deletedAt),
          ),
        )
        .limit(1);

      return rows.length > 0;
    }, pool);
  }

  /**
   * Asserts that a work date is not locked. Throws ValidationError if locked.
   */
  async assertPeriodUnlocked(
    companyId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    const isLocked = await this.isDateLocked(companyId, workDate, poolOverride);
    if (isLocked) {
      throw new ValidationError(`Attendance period for date ${workDate} is locked for payroll processing and cannot be modified.`);
    }
  }

  /**
   * Lists all period locks for the company.
   */
  async listLocks(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePeriodLock[]> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      return tx
        .select()
        .from(attendancePeriodLocks)
        .where(
          and(
            eq(attendancePeriodLocks.companyId, companyId),
            isNull(attendancePeriodLocks.deletedAt),
          ),
        )
        .orderBy(sql`${attendancePeriodLocks.periodStart} DESC`);
    }, pool);
  }
}
