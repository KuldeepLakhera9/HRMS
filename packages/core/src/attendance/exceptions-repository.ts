import type pg from 'pg';
import { withTenant } from '@hrms/db';
import type { ListExceptionsInput } from './exceptions-validation.js';

export interface AttendanceExceptionItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string | null;
  workDate: string;
  shiftName: string | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  firstIn: Date | null;
  lastOut: Date | null;
  punchCount: number;
  totalWorkMinutes: number;
  effectiveMinutes: number;
  lateInMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  status: string;
  isRegularized: boolean;
  isLocked: boolean;
  ruleVersion: number;
}

export interface ExceptionSummaryCounts {
  totalExceptions: number;
  missingPunch: number;
  lateIn: number;
  earlyOut: number;
  shortHours: number;
  unexcusedAbsence: number;
}

export interface CalendarDayViewItem {
  id: string;
  employeeId: string;
  workDate: string;
  status: string;
  shiftId: string | null;
  shiftName: string | null;
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
}

export class AttendanceExceptionsRepository {
  /**
   * Lists exceptions with keyset pagination and filtering.
   * Query budget: 1
   */
  async listExceptions(
    companyId: string,
    filters: ListExceptionsInput,
    poolOverride?: pg.Pool,
  ): Promise<{ items: AttendanceExceptionItem[]; nextCursor: { workDate: string; id: string } | null }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['ad.company_id = $1', 'ad.deleted_at IS NULL'];
        const values: unknown[] = [companyId];

        if (filters.startDate) {
          values.push(filters.startDate);
          conditions.push(`ad.work_date >= $${values.length}::date`);
        }

        if (filters.endDate) {
          values.push(filters.endDate);
          conditions.push(`ad.work_date <= $${values.length}::date`);
        }

        if (filters.employeeId) {
          values.push(filters.employeeId);
          conditions.push(`ad.employee_id = $${values.length}::uuid`);
        }

        if (filters.departmentId) {
          values.push(filters.departmentId);
          conditions.push(`e.department_id = $${values.length}::uuid`);
        }

        if (filters.isRegularized !== undefined) {
          values.push(filters.isRegularized);
          conditions.push(`ad.is_regularized = $${values.length}`);
        }

        // Exception type condition
        const type = filters.exceptionType ?? 'all';
        if (type === 'missing_punch') {
          conditions.push(`ad.status = 'missing_punch'`);
        } else if (type === 'late_in') {
          conditions.push(`ad.late_in_minutes > 0`);
        } else if (type === 'early_out') {
          conditions.push(`ad.early_out_minutes > 0`);
        } else if (type === 'short_hours') {
          conditions.push(`(ad.status = 'half_day' OR (ad.effective_minutes > 0 AND ad.effective_minutes < 480))`);
        } else if (type === 'unexcused_absence') {
          conditions.push(`(ad.status = 'absent' AND ad.punch_count = 0)`);
        } else {
          // 'all' exceptions
          conditions.push(
            `(ad.status = 'missing_punch' OR ad.late_in_minutes > 0 OR ad.early_out_minutes > 0 OR (ad.status IN ('half_day', 'absent') AND NOT ad.is_regularized))`
          );
        }

        // Keyset Cursor: (work_date DESC, id DESC)
        if (filters.cursorWorkDate && filters.cursorId) {
          values.push(filters.cursorWorkDate);
          values.push(filters.cursorId);
          conditions.push(`(ad.work_date, ad.id) < ($${values.length - 1}::date, $${values.length}::uuid)`);
        }

        const limit = filters.limit ?? 50;
        values.push(limit + 1);

        const sql = `
          SELECT
            ad.id,
            ad.employee_id as "employeeId",
            e.first_name || ' ' || e.last_name as "employeeName",
            e.emp_code as "employeeCode",
            d.name as "departmentName",
            to_char(ad.work_date, 'YYYY-MM-DD') as "workDate",
            s.name as "shiftName",
            s.start_time as "shiftStartTime",
            s.end_time as "shiftEndTime",
            ad.first_in as "firstIn",
            ad.last_out as "lastOut",
            ad.punch_count as "punchCount",
            ad.total_work_minutes as "totalWorkMinutes",
            ad.effective_minutes as "effectiveMinutes",
            ad.late_in_minutes as "lateInMinutes",
            ad.early_out_minutes as "earlyOutMinutes",
            ad.overtime_minutes as "overtimeMinutes",
            ad.status,
            ad.is_regularized as "isRegularized",
            ad.is_locked as "isLocked",
            ad.rule_version as "ruleVersion"
          FROM attendance_days ad
          JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id AND e.deleted_at IS NULL
          LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
          LEFT JOIN shifts s ON s.company_id = ad.company_id AND s.id = ad.shift_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY ad.work_date DESC, ad.id DESC
          LIMIT $${values.length}
        `;

        const res = await client.query(sql, values);
        const rows = res.rows.map((row) => ({
          ...row,
          firstIn: row.firstIn ? new Date(row.firstIn) : null,
          lastOut: row.lastOut ? new Date(row.lastOut) : null,
        }));

        let nextCursor: { workDate: string; id: string } | null = null;
        let items = rows;

        if (rows.length > limit) {
          items = rows.slice(0, limit);
          const lastItem = items[items.length - 1];
          if (lastItem) {
            nextCursor = { workDate: lastItem.workDate, id: lastItem.id };
          }
        }

        return { items, nextCursor };
      },
      poolOverride,
    );
  }

  /**
   * Retrieves summary counts for the exceptions dashboard cards.
   * Query budget: 1
   */
  async getExceptionSummary(
    companyId: string,
    startDate?: string,
    endDate?: string,
    poolOverride?: pg.Pool,
  ): Promise<ExceptionSummaryCounts> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['ad.company_id = $1', 'ad.deleted_at IS NULL', 'ad.is_regularized = false'];
        const values: unknown[] = [companyId];

        if (startDate) {
          values.push(startDate);
          conditions.push(`ad.work_date >= $${values.length}::date`);
        }
        if (endDate) {
          values.push(endDate);
          conditions.push(`ad.work_date <= $${values.length}::date`);
        }

        const sql = `
          SELECT
            COUNT(CASE WHEN ad.status = 'missing_punch' OR ad.late_in_minutes > 0 OR ad.early_out_minutes > 0 OR ad.status IN ('half_day', 'absent') THEN 1 END) as "totalExceptions",
            COUNT(CASE WHEN ad.status = 'missing_punch' THEN 1 END) as "missingPunch",
            COUNT(CASE WHEN ad.late_in_minutes > 0 THEN 1 END) as "lateIn",
            COUNT(CASE WHEN ad.early_out_minutes > 0 THEN 1 END) as "earlyOut",
            COUNT(CASE WHEN ad.status = 'half_day' OR (ad.effective_minutes > 0 AND ad.effective_minutes < 480) THEN 1 END) as "shortHours",
            COUNT(CASE WHEN ad.status = 'absent' AND ad.punch_count = 0 THEN 1 END) as "unexcusedAbsence"
          FROM attendance_days ad
          WHERE ${conditions.join(' AND ')}
        `;

        const res = await client.query(sql, values);
        const row = res.rows[0];
        return {
          totalExceptions: parseInt(row?.totalExceptions ?? '0', 10),
          missingPunch: parseInt(row?.missingPunch ?? '0', 10),
          lateIn: parseInt(row?.lateIn ?? '0', 10),
          earlyOut: parseInt(row?.earlyOut ?? '0', 10),
          shortHours: parseInt(row?.shortHours ?? '0', 10),
          unexcusedAbsence: parseInt(row?.unexcusedAbsence ?? '0', 10),
        };
      },
      poolOverride,
    );
  }

  /**
   * Fetches target day records by IDs for verification before bulk actions.
   * Query budget: 1
   */
  async getDaysByIds(
    companyId: string,
    dayIds: string[],
    poolOverride?: pg.Pool,
  ): Promise<Array<{ id: string; employeeId: string; workDate: string; isLocked: boolean; status: string }>> {
    if (dayIds.length === 0) return [];
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sql = `
          SELECT id, employee_id as "employeeId", to_char(work_date, 'YYYY-MM-DD') as "workDate", is_locked as "isLocked", status
          FROM attendance_days
          WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
        `;
        const res = await client.query(sql, [companyId, dayIds]);
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Performs bulk update on status and regularization flag.
   * Query budget: 1
   */
  async bulkUpdateDays(
    companyId: string,
    dayIds: string[],
    data: {
      status?: string;
      isRegularized: boolean;
      effectiveMinutes?: number;
      updatedBy: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<number> {
    if (dayIds.length === 0) return 0;
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const updates: string[] = [
          'is_regularized = $3',
          'updated_by = $4',
          'updated_at = NOW()',
        ];
        const values: unknown[] = [companyId, dayIds, data.isRegularized, data.updatedBy];

        if (data.status) {
          values.push(data.status);
          updates.push(`status = $${values.length}`);
        }

        if (data.effectiveMinutes !== undefined) {
          values.push(data.effectiveMinutes);
          updates.push(`effective_minutes = $${values.length}`);
        }

        const sql = `
          UPDATE attendance_days
          SET ${updates.join(', ')}
          WHERE company_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
        `;

        const res = await client.query(sql, values);
        return res.rowCount ?? 0;
      },
      poolOverride,
    );
  }

  /**
   * Fetches monthly calendar days for an employee.
   * Query budget: 1
   */
  async getMonthCalendarDays(
    companyId: string,
    employeeId: string,
    startDate: string,
    endDate: string,
    poolOverride?: pg.Pool,
  ): Promise<CalendarDayViewItem[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sql = `
          SELECT
            ad.id,
            ad.employee_id as "employeeId",
            to_char(ad.work_date, 'YYYY-MM-DD') as "workDate",
            ad.status,
            ad.shift_id as "shiftId",
            s.name as "shiftName",
            ad.first_in as "firstIn",
            ad.last_out as "lastOut",
            ad.punch_count as "punchCount",
            ad.total_work_minutes as "totalWorkMinutes",
            ad.effective_minutes as "effectiveMinutes",
            ad.late_in_minutes as "lateInMinutes",
            ad.early_out_minutes as "earlyOutMinutes",
            ad.overtime_minutes as "overtimeMinutes",
            ad.is_regularized as "isRegularized",
            ad.is_locked as "isLocked"
          FROM attendance_days ad
          LEFT JOIN shifts s ON s.company_id = ad.company_id AND s.id = ad.shift_id
          WHERE ad.company_id = $1
            AND ad.employee_id = $2
            AND ad.work_date >= $3::date
            AND ad.work_date <= $4::date
            AND ad.deleted_at IS NULL
          ORDER BY ad.work_date ASC
        `;

        const res = await client.query(sql, [companyId, employeeId, startDate, endDate]);
        return res.rows.map((row) => ({
          ...row,
          firstIn: row.firstIn ? new Date(row.firstIn) : null,
          lastOut: row.lastOut ? new Date(row.lastOut) : null,
        }));
      },
      poolOverride,
    );
  }
}
