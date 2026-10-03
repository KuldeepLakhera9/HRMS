import type pg from 'pg';
import { DateTime } from 'luxon';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { AuditService } from '../audit/service.js';
import {
  ShiftRepository,
  type ShiftRecord,
  type RosterRecord,
  type RosterWithShift,
} from './shift-repository.js';
import type {
  CreateShiftInput,
  UpdateShiftInput,
  AssignRosterInput,
  BulkAssignRosterInput,
  RosterQueryInput,
} from './shift-validation.js';

export interface ShiftResolutionResult {
  shift: ShiftRecord;
  shiftDate: string; // YYYY-MM-DD
  isNightShift: boolean;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveAuditUserId(userId?: string): string {
  if (userId && UUID_REGEX.test(userId)) return userId;
  return NIL_UUID;
}

export class ShiftService {
  private repository: ShiftRepository;
  private auditService: AuditService;

  constructor(repository?: ShiftRepository, auditService?: AuditService) {
    this.repository = repository ?? new ShiftRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Creates a new shift.
   */
  async createShift(
    ctx: RequestContext,
    input: CreateShiftInput,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_SHIFT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage shifts.');
    }

    const existing = await this.repository.getShiftByCode(ctx.companyId, input.code, poolOverride);
    if (existing) {
      throw new ConflictError(`Shift with code '${input.code}' already exists.`);
    }

    const shift = await this.repository.createShift(
      ctx.companyId,
      { ...input, createdBy: resolveAuditUserId(ctx.userId) },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.shift.create',
      entity: 'shifts',
      entityId: shift.id,
      after: shift as unknown as Record<string, unknown>,
      poolOverride,
    });

    return shift;
  }

  /**
   * Updates an existing shift.
   */
  async updateShift(
    ctx: RequestContext,
    id: string,
    input: UpdateShiftInput,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_SHIFT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage shifts.');
    }

    const before = await this.repository.getShiftById(ctx.companyId, id, poolOverride);
    if (!before) {
      throw new NotFoundError('Shift not found.');
    }

    const updated = await this.repository.updateShift(
      ctx.companyId,
      id,
      { ...input, updatedBy: resolveAuditUserId(ctx.userId) },
      poolOverride,
    );

    if (!updated) {
      throw new NotFoundError('Shift not found.');
    }

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.shift.update',
      entity: 'shifts',
      entityId: id,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      poolOverride,
    });

    return updated;
  }

  /**
   * Retrieves a shift by ID.
   */
  async getShift(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_SHIFT_READ)) {
      throw new ForbiddenError('You do not have permission to view shifts.');
    }

    const shift = await this.repository.getShiftById(ctx.companyId, id, poolOverride);
    if (!shift) {
      throw new NotFoundError('Shift not found.');
    }

    return shift;
  }

  /**
   * Lists all shifts.
   */
  async listShifts(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord[]> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_SHIFT_READ)) {
      throw new ForbiddenError('You do not have permission to view shifts.');
    }

    return this.repository.listShifts(ctx.companyId, poolOverride);
  }

  /**
   * Assigns a single roster entry.
   */
  async assignRoster(
    ctx: RequestContext,
    input: AssignRosterInput,
    poolOverride?: pg.Pool,
  ): Promise<RosterRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_ROSTER_MANAGE)) {
      throw new ForbiddenError('You do not have permission to assign rosters.');
    }

    const shift = await this.repository.getShiftById(ctx.companyId, input.shiftId, poolOverride);
    if (!shift) {
      throw new NotFoundError('Shift not found.');
    }

    return this.repository.assignRoster(
      ctx.companyId,
      { ...input, createdBy: resolveAuditUserId(ctx.userId) },
      poolOverride,
    );
  }

  /**
   * Bulk assigns roster entries.
   */
  async bulkAssignRosters(
    ctx: RequestContext,
    input: BulkAssignRosterInput,
    poolOverride?: pg.Pool,
  ): Promise<{ assignedCount: number }> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_ROSTER_MANAGE)) {
      throw new ForbiddenError('You do not have permission to assign rosters.');
    }

    const items = input.assignments.map(a => ({
      ...a,
      createdBy: resolveAuditUserId(ctx.userId),
    }));

    const count = await this.repository.bulkAssignRosters(ctx.companyId, items, poolOverride);
    return { assignedCount: count };
  }

  /**
   * Retrieves rosters for a date range.
   */
  async getRosterRange(
    ctx: RequestContext,
    query: RosterQueryInput,
    poolOverride?: pg.Pool,
  ): Promise<RosterWithShift[]> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_ROSTER_READ)) {
      throw new ForbiddenError('You do not have permission to view rosters.');
    }

    return this.repository.getRostersForDateRange(ctx.companyId, query, poolOverride);
  }

  /**
   * Resolves the shift and shift date for a given punch event timestamp.
   * Accurately handles:
   * 1. Night shifts crossing midnight:
   *    If yesterday had a night shift (e.g. 22:00 - 06:00), punches occurring between 00:00 and
   *    (shift_end + grace + 120m buffer) belong to yesterday's shiftDate!
   * 2. Daytime shifts:
   *    Punches belong to today's local date in the location's timezone.
   * 3. Fallback:
   *    If no roster is published, resolves to default shift.
   */
  async resolveShiftAndDate(
    companyId: string,
    employeeId: string,
    punchTimestamp: Date,
    locationTimezone: string = 'Asia/Kolkata',
    poolOverride?: pg.Pool,
  ): Promise<ShiftResolutionResult> {
    const localDt = DateTime.fromJSDate(punchTimestamp, { zone: locationTimezone });
    const localDateStr = localDt.toISODate(); // YYYY-MM-DD
    const prevDateStr = localDt.minus({ days: 1 }).toISODate();

    if (!localDateStr || !prevDateStr) {
      throw new Error('Invalid timezone or date computation');
    }

    // 1. Check if previous day had a night shift crossing midnight
    const prevRoster = await this.repository.getRosterForDate(
      companyId,
      employeeId,
      prevDateStr,
      poolOverride,
    );

    if (prevRoster && prevRoster.shift.crossesMidnight && !prevRoster.isWeeklyOff && !prevRoster.isHoliday) {
      // Parse shift end time: "HH:MM:SS" or "HH:MM"
      const [endH = '06', endM = '00'] = prevRoster.shift.endTime.split(':');
      const endHour = parseInt(endH, 10);
      const endMinute = parseInt(endM, 10);

      // Night shift cutoff on next day: endTime + grace + 120m buffer (or at least noon 12:00)
      const bufferMinutes = (prevRoster.shift.graceMinutes || 15) + 120;
      const cutoffDt = localDt.startOf('day').plus({ hours: endHour, minutes: endMinute + bufferMinutes });

      if (localDt <= cutoffDt) {
        // Punch belongs to previous day's night shift
        return {
          shift: prevRoster.shift,
          shiftDate: prevDateStr,
          isNightShift: true,
        };
      }
    }

    // 2. Check today's roster
    const todayRoster = await this.repository.getRosterForDate(
      companyId,
      employeeId,
      localDateStr,
      poolOverride,
    );

    if (todayRoster) {
      return {
        shift: todayRoster.shift,
        shiftDate: localDateStr,
        isNightShift: todayRoster.shift.crossesMidnight,
      };
    }

    // 3. Fallback to company default shift
    const defaultShift = await this.repository.getDefaultShift(companyId, poolOverride);
    if (defaultShift) {
      return {
        shift: defaultShift,
        shiftDate: localDateStr,
        isNightShift: defaultShift.crossesMidnight,
      };
    }

    // 4. Default standard 9-to-6 general shift fallback
    const standardGeneralShift: ShiftRecord = {
      id: '00000000-0000-0000-0000-000000000001',
      companyId,
      code: 'GENERAL',
      name: 'General Shift',
      startTime: '09:00:00',
      endTime: '18:00:00',
      crossesMidnight: false,
      graceMinutes: 15,
      breakMinutes: 60,
      workHours: '8.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return {
      shift: standardGeneralShift,
      shiftDate: localDateStr,
      isNightShift: false,
    };
  }
}
