import { z } from 'zod';
import type pg from 'pg';
import { PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import type { ReportDefinition } from './types.js';

/**
 * Filter schema for attendance summary report.
 * Requires period (YYYY-MM). Optional departmentId and employeeId.
 */
export const attendanceSummaryFilterSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format'),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
});

export type AttendanceSummaryFilters = z.infer<typeof attendanceSummaryFilterSchema>;

/**
 * Filter schema for daily attendance register.
 * Requires startDate and endDate (max 31 days).
 */
export const dailyAttendanceRegisterFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'on_duty', 'wfh']).optional(),
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 31;
}, { message: 'Date range cannot exceed 31 days' });

export type DailyAttendanceRegisterFilters = z.infer<typeof dailyAttendanceRegisterFilterSchema>;

/**
 * Filter schema for late marks and absenteeism report.
 * Requires startDate and endDate (max 90 days).
 */
export const lateMarksFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  incidentType: z.enum(['all', 'late', 'absent', 'early_exit']).optional(),
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 90;
}, { message: 'Date range cannot exceed 90 days' });

export type LateMarksFilters = z.infer<typeof lateMarksFilterSchema>;

/**
 * Attendance Summary Report Definition
 */
export const attendanceSummaryReport: ReportDefinition<AttendanceSummaryFilters> = {
  key: 'attendance_summary',
  title: 'Monthly Attendance Summary',
  description: 'Aggregated monthly attendance, leaves, late counts, and hours worked per employee',
  category: 'attendance',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: attendanceSummaryFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'period', header: 'Period', type: 'string', align: 'center' },
    { key: 'present', header: 'Present', type: 'number', align: 'right' },
    { key: 'absent', header: 'Absent', type: 'number', align: 'right' },
    { key: 'halfDays', header: 'Half Days', type: 'number', align: 'right' },
    { key: 'lateCount', header: 'Late Marks', type: 'number', align: 'right' },
    { key: 'earlyExitCount', header: 'Early Exits', type: 'number', align: 'right' },
    { key: 'weeklyOff', header: 'Weekly Offs', type: 'number', align: 'right' },
    { key: 'holidays', header: 'Holidays', type: 'number', align: 'right' },
    { key: 'leaveDays', header: 'Leaves', type: 'number', align: 'right' },
    { key: 'lopDays', header: 'LOP Days', type: 'number', align: 'right' },
    { key: 'workedHours', header: 'Worked Hours', type: 'number', align: 'right' },
    { key: 'overtimeHours', header: 'OT Hours', type: 'number', align: 'right' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: AttendanceSummaryFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = ['aps.company_id = $1', 'aps.period = $2'];
    const values: unknown[] = [ctx.companyId, filters.period];
    let paramIndex = 3;

    // Scope check: if user cannot run company-wide reports, restrict to self or team
    const roles = ctx.roles ?? [];
    const hasCompanyScope = roles.includes('super_admin') || roles.includes('hr_manager') || roles.includes('accountant');
    if (!hasCompanyScope) {
      if (roles.includes('manager') && ctx.employeeId) {
        conditions.push(`(e.id = $${paramIndex} OR e.manager_id = $${paramIndex})`);
        values.push(ctx.employeeId);
        paramIndex++;
      } else if (ctx.employeeId) {
        conditions.push(`e.id = $${paramIndex}`);
        values.push(ctx.employeeId);
        paramIndex++;
      }
    }

    if (filters.departmentId) {
      conditions.push(`e.department_id = $${paramIndex}`);
      values.push(filters.departmentId);
      paramIndex++;
    }

    if (filters.employeeId) {
      conditions.push(`e.id = $${paramIndex}`);
      values.push(filters.employeeId);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countSql = `
      SELECT COUNT(*)::int as total
      FROM attendance_period_summary aps
      JOIN employees e ON e.company_id = aps.company_id AND e.id = aps.employee_id
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    // Data query
    let dataSql = `
      SELECT 
        e.employee_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        aps.period,
        aps.present::float AS "present",
        aps.absent::float AS "absent",
        aps.half_days AS "halfDays",
        aps.late_count AS "lateCount",
        aps.early_exit_count AS "earlyExitCount",
        aps.weekly_off::float AS "weeklyOff",
        aps.holidays::float AS "holidays",
        aps.leave_days::float AS "leaveDays",
        aps.lop_days::float AS "lopDays",
        ROUND((aps.worked_minutes / 60.0)::numeric, 1)::float AS "workedHours",
        ROUND((aps.overtime_minutes / 60.0)::numeric, 1)::float AS "overtimeHours"
      FROM attendance_period_summary aps
      JOIN employees e ON e.company_id = aps.company_id AND e.id = aps.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY e.employee_code ASC
    `;

    if (pagination?.limit) {
      dataSql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(pagination.limit, pagination.offset ?? 0);
    }

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

/**
 * Daily Attendance Register Report Definition
 */
export const dailyAttendanceRegisterReport: ReportDefinition<DailyAttendanceRegisterFilters> = {
  key: 'daily_attendance_register',
  title: 'Daily Attendance Register',
  description: 'Daily matrix of employee in/out times, worked minutes, and day status',
  category: 'attendance',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: dailyAttendanceRegisterFilterSchema,
  columns: [
    { key: 'date', header: 'Date', type: 'date', align: 'center' },
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'inTime', header: 'First In', type: 'string', align: 'center' },
    { key: 'outTime', header: 'Last Out', type: 'string', align: 'center' },
    { key: 'workedMinutes', header: 'Worked (Mins)', type: 'minutes', align: 'right' },
    { key: 'lateMinutes', header: 'Late (Mins)', type: 'minutes', align: 'right' },
    { key: 'earlyExitMinutes', header: 'Early Exit (Mins)', type: 'minutes', align: 'right' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  maxDateRangeDays: 31,
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: DailyAttendanceRegisterFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = [
      'ad.company_id = $1',
      'ad.work_date >= $2',
      'ad.work_date <= $3',
    ];
    const values: unknown[] = [ctx.companyId, filters.startDate, filters.endDate];
    let paramIndex = 4;

    const roles = ctx.roles ?? [];
    const hasCompanyScope = roles.includes('super_admin') || roles.includes('hr_manager') || roles.includes('accountant');
    if (!hasCompanyScope) {
      if (roles.includes('manager') && ctx.employeeId) {
        conditions.push(`(e.id = $${paramIndex} OR e.manager_id = $${paramIndex})`);
        values.push(ctx.employeeId);
        paramIndex++;
      } else if (ctx.employeeId) {
        conditions.push(`e.id = $${paramIndex}`);
        values.push(ctx.employeeId);
        paramIndex++;
      }
    }

    if (filters.departmentId) {
      conditions.push(`e.department_id = $${paramIndex}`);
      values.push(filters.departmentId);
      paramIndex++;
    }

    if (filters.employeeId) {
      conditions.push(`e.id = $${paramIndex}`);
      values.push(filters.employeeId);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`ad.status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        TO_CHAR(ad.work_date, 'YYYY-MM-DD') AS "date",
        e.employee_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        ad.status,
        TO_CHAR(p_in.punch_time, 'HH24:MI') AS "inTime",
        TO_CHAR(p_out.punch_time, 'HH24:MI') AS "outTime",
        ad.total_minutes AS "workedMinutes",
        ad.late_minutes AS "lateMinutes",
        ad.early_exit_minutes AS "earlyExitMinutes"
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      LEFT JOIN attendance_punches p_in ON p_in.company_id = ad.company_id AND p_in.id = ad.in_punch_id
      LEFT JOIN attendance_punches p_out ON p_out.company_id = ad.company_id AND p_out.id = ad.out_punch_id
      WHERE ${whereClause}
      ORDER BY ad.work_date DESC, e.employee_code ASC
    `;

    if (pagination?.limit) {
      dataSql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(pagination.limit, pagination.offset ?? 0);
    }

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

/**
 * Late Marks & Absenteeism Report Definition
 */
export const lateMarksAndAbsenteeismReport: ReportDefinition<LateMarksFilters> = {
  key: 'late_marks_and_absenteeism',
  title: 'Late Marks & Absenteeism Report',
  description: 'Detailed audit of tardiness, early departures, and unexcused absences',
  category: 'attendance',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: lateMarksFilterSchema,
  columns: [
    { key: 'date', header: 'Date', type: 'date', align: 'center' },
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'incidentType', header: 'Incident', type: 'badge', align: 'center' },
    { key: 'lateMinutes', header: 'Late (Mins)', type: 'minutes', align: 'right' },
    { key: 'earlyExitMinutes', header: 'Early Exit (Mins)', type: 'minutes', align: 'right' },
    { key: 'status', header: 'Day Status', type: 'string', align: 'center' },
    { key: 'penalized', header: 'LOP / Penalized', type: 'badge', align: 'center' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  maxDateRangeDays: 90,
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: LateMarksFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = [
      'ad.company_id = $1',
      'ad.work_date >= $2',
      'ad.work_date <= $3',
    ];
    const values: unknown[] = [ctx.companyId, filters.startDate, filters.endDate];
    let paramIndex = 4;

    if (filters.incidentType === 'late') {
      conditions.push('ad.late_minutes > 0');
    } else if (filters.incidentType === 'absent') {
      conditions.push("ad.status = 'absent'");
    } else if (filters.incidentType === 'early_exit') {
      conditions.push('ad.early_exit_minutes > 0');
    } else {
      conditions.push("(ad.late_minutes > 0 OR ad.early_exit_minutes > 0 OR ad.status = 'absent')");
    }

    const roles = ctx.roles ?? [];
    const hasCompanyScope = roles.includes('super_admin') || roles.includes('hr_manager') || roles.includes('accountant');
    if (!hasCompanyScope) {
      if (roles.includes('manager') && ctx.employeeId) {
        conditions.push(`(e.id = $${paramIndex} OR e.manager_id = $${paramIndex})`);
        values.push(ctx.employeeId);
        paramIndex++;
      } else if (ctx.employeeId) {
        conditions.push(`e.id = $${paramIndex}`);
        values.push(ctx.employeeId);
        paramIndex++;
      }
    }

    if (filters.departmentId) {
      conditions.push(`e.department_id = $${paramIndex}`);
      values.push(filters.departmentId);
      paramIndex++;
    }

    if (filters.employeeId) {
      conditions.push(`e.id = $${paramIndex}`);
      values.push(filters.employeeId);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        TO_CHAR(ad.work_date, 'YYYY-MM-DD') AS "date",
        e.employee_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        CASE 
          WHEN ad.status = 'absent' THEN 'Absent'
          WHEN ad.late_minutes > 0 AND ad.early_exit_minutes > 0 THEN 'Late & Early Exit'
          WHEN ad.late_minutes > 0 THEN 'Late Arrival'
          WHEN ad.early_exit_minutes > 0 THEN 'Early Exit'
          ELSE 'Anomaly'
        END AS "incidentType",
        ad.late_minutes AS "lateMinutes",
        ad.early_exit_minutes AS "earlyExitMinutes",
        ad.status,
        CASE 
          WHEN ad.lop_days > 0 THEN 'Yes (LOP)'
          ELSE 'No'
        END AS "penalized"
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY ad.work_date DESC, e.employee_code ASC
    `;

    if (pagination?.limit) {
      dataSql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(pagination.limit, pagination.offset ?? 0);
    }

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

/**
 * Report Registry Singleton
 */
export class ReportRegistry {
  private static reports: Map<string, ReportDefinition> = new Map();

  static {
    // Register initial reports
    this.register(attendanceSummaryReport as unknown as ReportDefinition);
    this.register(dailyAttendanceRegisterReport as unknown as ReportDefinition);
    this.register(lateMarksAndAbsenteeismReport as unknown as ReportDefinition);
  }

  static register(report: ReportDefinition): void {
    this.reports.set(report.key, report);
  }

  static get(key: string): ReportDefinition | undefined {
    return this.reports.get(key);
  }

  static getAll(): ReportDefinition[] {
    return Array.from(this.reports.values());
  }
}
