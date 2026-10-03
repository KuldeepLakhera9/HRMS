import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type {
  CreateShiftInput,
  UpdateShiftInput,
  AssignRosterInput,
} from './shift-validation.js';

export interface ShiftRecord {
  id: string;
  companyId: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  graceMinutes: number;
  breakMinutes: number;
  workHours: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RosterRecord {
  id: string;
  companyId: string;
  employeeId: string;
  shiftId: string;
  workDate: string;
  isWeeklyOff: boolean;
  isHoliday: boolean;
  status: 'draft' | 'published';
  createdAt: Date;
}

export interface RosterWithShift extends RosterRecord {
  shift: ShiftRecord;
}

export class ShiftRepository {
  /**
   * Creates a new shift definition.
   */
  async createShift(
    companyId: string,
    input: CreateShiftInput & { createdBy: string },
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query(
          `INSERT INTO shifts (
            id, company_id, code, name, start_time, end_time,
            crosses_midnight, grace_minutes, break_minutes, work_hours,
            created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11
          )
          RETURNING
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"`,
          [
            id,
            companyId,
            input.code,
            input.name,
            input.startTime,
            input.endTime,
            input.crossesMidnight,
            input.graceMinutes,
            input.breakMinutes,
            input.workHours,
            input.createdBy,
          ],
        );
        return res.rows[0];
      },
      poolOverride,
    );
  }

  /**
   * Retrieves a shift by ID.
   */
  async getShiftById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM shifts
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Retrieves a shift by code.
   */
  async getShiftByCode(
    companyId: string,
    code: string,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM shifts
          WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL`,
          [companyId, code],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Updates an existing shift definition.
   */
  async updateShift(
    companyId: string,
    id: string,
    input: UpdateShiftInput & { updatedBy: string },
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const setClauses: string[] = ['updated_at = NOW()', 'row_version = row_version + 1', 'updated_by = $3'];
        const values: unknown[] = [companyId, id, input.updatedBy];

        const fieldMap: Record<string, string> = {
          name: 'name',
          startTime: 'start_time',
          endTime: 'end_time',
          crossesMidnight: 'crosses_midnight',
          graceMinutes: 'grace_minutes',
          breakMinutes: 'break_minutes',
          workHours: 'work_hours',
        };

        for (const [key, col] of Object.entries(fieldMap)) {
          if ((input as Record<string, unknown>)[key] !== undefined) {
            values.push((input as Record<string, unknown>)[key]);
            setClauses.push(`${col} = $${values.length}`);
          }
        }

        const res = await client.query(
          `UPDATE shifts
           SET ${setClauses.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"`,
          values,
        );

        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Lists all active shifts for a company.
   */
  async listShifts(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM shifts
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Retrieves company default shift (first shift or 'GENERAL').
   */
  async getDefaultShift(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<ShiftRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name,
            start_time as "startTime", end_time as "endTime",
            crosses_midnight as "crossesMidnight", grace_minutes as "graceMinutes",
            break_minutes as "breakMinutes", work_hours as "workHours",
            created_at as "createdAt", updated_at as "updatedAt"
          FROM shifts
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY (CASE WHEN code = 'GENERAL' THEN 0 ELSE 1 END), created_at ASC
          LIMIT 1`,
          [companyId],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Assigns a shift to an employee on a work date (upserts).
   */
  async assignRoster(
    companyId: string,
    input: AssignRosterInput & { createdBy: string },
    poolOverride?: pg.Pool,
  ): Promise<RosterRecord> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query(
          `INSERT INTO rosters (
            id, company_id, employee_id, shift_id, work_date,
            is_weekly_off, is_holiday, status, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
          )
          ON CONFLICT (company_id, employee_id, work_date)
          DO UPDATE SET
            shift_id = EXCLUDED.shift_id,
            is_weekly_off = EXCLUDED.is_weekly_off,
            is_holiday = EXCLUDED.is_holiday,
            status = EXCLUDED.status,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
          RETURNING
            id, company_id as "companyId", employee_id as "employeeId",
            shift_id as "shiftId", work_date as "workDate",
            is_weekly_off as "isWeeklyOff", is_holiday as "isHoliday",
            status, created_at as "createdAt"`,
          [
            id,
            companyId,
            input.employeeId,
            input.shiftId,
            input.workDate,
            input.isWeeklyOff,
            input.isHoliday,
            input.status,
            input.createdBy,
          ],
        );
        return res.rows[0];
      },
      poolOverride,
    );
  }

  /**
   * Bulk assigns rosters inside a transaction.
   */
  async bulkAssignRosters(
    companyId: string,
    assignments: Array<AssignRosterInput & { createdBy: string }>,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        let count = 0;
        for (const item of assignments) {
          const id = generateUuidV7();
          await client.query(
            `INSERT INTO rosters (
              id, company_id, employee_id, shift_id, work_date,
              is_weekly_off, is_holiday, status, created_by, updated_by
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
            )
            ON CONFLICT (company_id, employee_id, work_date)
            DO UPDATE SET
              shift_id = EXCLUDED.shift_id,
              is_weekly_off = EXCLUDED.is_weekly_off,
              is_holiday = EXCLUDED.is_holiday,
              status = EXCLUDED.status,
              updated_at = NOW(),
              updated_by = EXCLUDED.updated_by`,
            [
              id,
              companyId,
              item.employeeId,
              item.shiftId,
              item.workDate,
              item.isWeeklyOff,
              item.isHoliday,
              item.status,
              item.createdBy,
            ],
          );
          count++;
        }
        return count;
      },
      poolOverride,
    );
  }

  /**
   * Gets published roster for an employee on a specific date with shift details.
   */
  async getRosterForDate(
    companyId: string,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<RosterWithShift | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            r.id, r.company_id as "companyId", r.employee_id as "employeeId",
            r.shift_id as "shiftId", r.work_date as "workDate",
            r.is_weekly_off as "isWeeklyOff", r.is_holiday as "isHoliday",
            r.status, r.created_at as "createdAt",
            s.id as s_id, s.code as s_code, s.name as s_name,
            s.start_time as s_start_time, s.end_time as s_end_time,
            s.crosses_midnight as s_crosses_midnight, s.grace_minutes as s_grace_minutes,
            s.break_minutes as s_break_minutes, s.work_hours as s_work_hours,
            s.created_at as s_created_at, s.updated_at as s_updated_at
          FROM rosters r
          JOIN shifts s ON s.company_id = r.company_id AND s.id = r.shift_id AND s.deleted_at IS NULL
          WHERE r.company_id = $1
            AND r.employee_id = $2
            AND r.work_date = $3
            AND r.deleted_at IS NULL
            AND r.status = 'published'`,
          [companyId, employeeId, workDate],
        );

        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
          id: row.id,
          companyId: row.companyId,
          employeeId: row.employeeId,
          shiftId: row.shiftId,
          workDate: row.workDate,
          isWeeklyOff: row.isWeeklyOff,
          isHoliday: row.isHoliday,
          status: row.status,
          createdAt: row.createdAt,
          shift: {
            id: row.s_id,
            companyId: row.companyId,
            code: row.s_code,
            name: row.s_name,
            startTime: row.s_start_time,
            endTime: row.s_end_time,
            crossesMidnight: row.s_crosses_midnight,
            graceMinutes: row.s_grace_minutes,
            breakMinutes: row.s_break_minutes,
            workHours: row.s_work_hours,
            createdAt: row.s_created_at,
            updatedAt: row.s_updated_at,
          },
        };
      },
      poolOverride,
    );
  }

  /**
   * Lists rosters for an employee across a date range.
   */
  async getRostersForDateRange(
    companyId: string,
    filters: { employeeId?: string | undefined; startDate: string; endDate: string },
    poolOverride?: pg.Pool,
  ): Promise<RosterWithShift[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = [
          'r.company_id = $1',
          'r.deleted_at IS NULL',
          'r.work_date >= $2',
          'r.work_date <= $3',
        ];
        const values: unknown[] = [companyId, filters.startDate, filters.endDate];

        if (filters.employeeId) {
          values.push(filters.employeeId);
          conditions.push(`r.employee_id = $${values.length}`);
        }

        const res = await client.query(
          `SELECT
            r.id, r.company_id as "companyId", r.employee_id as "employeeId",
            r.shift_id as "shiftId", r.work_date as "workDate",
            r.is_weekly_off as "isWeeklyOff", r.is_holiday as "isHoliday",
            r.status, r.created_at as "createdAt",
            s.id as s_id, s.code as s_code, s.name as s_name,
            s.start_time as s_start_time, s.end_time as s_end_time,
            s.crosses_midnight as s_crosses_midnight, s.grace_minutes as s_grace_minutes,
            s.break_minutes as s_break_minutes, s.work_hours as s_work_hours,
            s.created_at as s_created_at, s.updated_at as s_updated_at
          FROM rosters r
          JOIN shifts s ON s.company_id = r.company_id AND s.id = r.shift_id AND s.deleted_at IS NULL
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.work_date ASC`,
          values,
        );

        return res.rows.map(row => ({
          id: row.id,
          companyId: row.companyId,
          employeeId: row.employeeId,
          shiftId: row.shiftId,
          workDate: row.workDate,
          isWeeklyOff: row.isWeeklyOff,
          isHoliday: row.isHoliday,
          status: row.status,
          createdAt: row.createdAt,
          shift: {
            id: row.s_id,
            companyId: row.companyId,
            code: row.s_code,
            name: row.s_name,
            startTime: row.s_start_time,
            endTime: row.s_end_time,
            crossesMidnight: row.s_crosses_midnight,
            graceMinutes: row.s_grace_minutes,
            breakMinutes: row.s_break_minutes,
            workHours: row.s_work_hours,
            createdAt: row.s_created_at,
            updatedAt: row.s_updated_at,
          },
        }));
      },
      poolOverride,
    );
  }
}
