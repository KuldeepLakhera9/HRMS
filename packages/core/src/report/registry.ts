import { z } from 'zod';
import type pg from 'pg';
import { PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import type { ReportDefinition } from './types.js';
import {
  payrollRegisterReport,
  payrollVarianceReport,
  departmentCostReport,
  bankSummaryReport,
  statutorySummaryReport,
  ytdLedgerReport,
  joinersExitsImpactReport,
  payslipDistributionReport,
  ctcVsGrossReconReport,
  gratuityProvisionReport,
} from './payroll-reports.js';

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
        e.emp_code AS "empCode",
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
      ORDER BY e.emp_code ASC
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
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        ad.status,
        TO_CHAR(ad.first_in, 'HH24:MI') AS "inTime",
        TO_CHAR(ad.last_out, 'HH24:MI') AS "outTime",
        ad.total_work_minutes AS "workedMinutes",
        ad.late_in_minutes AS "lateMinutes",
        ad.early_out_minutes AS "earlyExitMinutes"
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY ad.work_date DESC, e.emp_code ASC
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
      conditions.push('ad.late_in_minutes > 0');
    } else if (filters.incidentType === 'absent') {
      conditions.push("ad.status = 'absent'");
    } else if (filters.incidentType === 'early_exit') {
      conditions.push('ad.early_out_minutes > 0');
    } else {
      conditions.push("(ad.late_in_minutes > 0 OR ad.early_out_minutes > 0 OR ad.status = 'absent')");
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
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        CASE 
          WHEN ad.status = 'absent' THEN 'Absent'
          WHEN ad.late_in_minutes > 0 AND ad.early_out_minutes > 0 THEN 'Late & Early Exit'
          WHEN ad.late_in_minutes > 0 THEN 'Late Arrival'
          WHEN ad.early_out_minutes > 0 THEN 'Early Exit'
          ELSE 'Anomaly'
        END AS "incidentType",
        ad.late_in_minutes AS "lateMinutes",
        ad.early_out_minutes AS "earlyExitMinutes",
        ad.status,
        CASE 
          WHEN ad.lop_days > 0 THEN 'Yes (LOP)'
          ELSE 'No'
        END AS "penalized"
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY ad.work_date DESC, e.emp_code ASC
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
 * Filter schema for attendance exceptions report.
 */
export const attendanceExceptionsFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  exceptionType: z.enum(['all', 'missing_swipe', 'short_duration', 'unauthorized_absence']).optional(),
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 60;
}, { message: 'Date range cannot exceed 60 days' });

export type AttendanceExceptionsFilters = z.infer<typeof attendanceExceptionsFilterSchema>;

/**
 * Attendance Exceptions Report Definition (Report 4)
 */
export const attendanceExceptionsReport: ReportDefinition<AttendanceExceptionsFilters> = {
  key: 'attendance_exceptions',
  title: 'Attendance Exceptions',
  description: 'Missing punches, unauthorized absences, and irregular shifts',
  category: 'attendance',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: attendanceExceptionsFilterSchema,
  columns: [
    { key: 'date', header: 'Date', type: 'date', align: 'center' },
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'exceptionType', header: 'Exception Type', type: 'badge', align: 'center' },
    { key: 'inTime', header: 'In Time', type: 'string', align: 'center' },
    { key: 'outTime', header: 'Out Time', type: 'string', align: 'center' },
    { key: 'workedMinutes', header: 'Worked (Mins)', type: 'minutes', align: 'right' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'regularized', header: 'Regularized', type: 'badge', align: 'center' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  maxDateRangeDays: 60,
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: AttendanceExceptionsFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = [
      'ad.company_id = $1',
      'ad.work_date >= $2',
      'ad.work_date <= $3',
    ];
    const values: unknown[] = [ctx.companyId, filters.startDate, filters.endDate];
    let paramIndex = 4;

    if (filters.exceptionType === 'missing_swipe') {
      conditions.push('(ad.first_in IS NULL OR ad.last_out IS NULL)');
    } else if (filters.exceptionType === 'short_duration') {
      conditions.push("(ad.total_work_minutes < 240 AND ad.status = 'present')");
    } else if (filters.exceptionType === 'unauthorized_absence') {
      conditions.push("(ad.status = 'absent' AND ad.is_regularized = false)");
    } else {
      conditions.push("((ad.first_in IS NULL AND ad.status = 'present') OR (ad.last_out IS NULL AND ad.status = 'present') OR (ad.total_work_minutes < 240 AND ad.status = 'present') OR (ad.status = 'absent' AND ad.is_regularized = false))");
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
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        CASE 
          WHEN ad.status = 'absent' AND ad.is_regularized = false THEN 'Unauthorized Absence'
          WHEN ad.first_in IS NULL OR ad.last_out IS NULL THEN 'Missing Swipe'
          WHEN ad.total_work_minutes < 240 THEN 'Short Work Hours (<4h)'
          ELSE 'Irregularity'
        END AS "exceptionType",
        COALESCE(TO_CHAR(ad.first_in, 'HH24:MI'), '-') AS "inTime",
        COALESCE(TO_CHAR(ad.last_out, 'HH24:MI'), '-') AS "outTime",
        ad.total_work_minutes AS "workedMinutes",
        ad.status,
        CASE WHEN ad.is_regularized THEN 'Yes' ELSE 'No' END AS "regularized"
      FROM attendance_days ad
      JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY ad.work_date DESC, e.emp_code ASC
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
 * Filter schema for leave balances report.
 */
export const leaveBalancesFilterSchema = z.object({
  periodKey: z.string().min(4).max(10),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
});

export type LeaveBalancesFilters = z.infer<typeof leaveBalancesFilterSchema>;

/**
 * Leave Balances Report Definition (Report 5)
 */
export const leaveBalancesReport: ReportDefinition<LeaveBalancesFilters> = {
  key: 'leave_balances',
  title: 'Leave Balances Report',
  description: 'Employee leave balances: opening, accrued, used, adjusted, and available balance',
  category: 'leave',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: leaveBalancesFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'leaveType', header: 'Leave Type', type: 'string', align: 'left' },
    { key: 'periodKey', header: 'Period', type: 'string', align: 'center' },
    { key: 'opening', header: 'Opening', type: 'number', align: 'right' },
    { key: 'accrued', header: 'Accrued', type: 'number', align: 'right' },
    { key: 'used', header: 'Used', type: 'number', align: 'right' },
    { key: 'adjusted', header: 'Adjusted', type: 'number', align: 'right' },
    { key: 'pending', header: 'Pending', type: 'number', align: 'right' },
    { key: 'closing', header: 'Available Balance', type: 'number', align: 'right' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: LeaveBalancesFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = ['lb.company_id = $1', 'lb.period_key = $2'];
    const values: unknown[] = [ctx.companyId, filters.periodKey || '2026'];
    let paramIndex = 3;

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

    if (filters.leaveTypeId) {
      conditions.push(`lb.leave_type_id = $${paramIndex}`);
      values.push(filters.leaveTypeId);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM leave_balances lb
      JOIN employees e ON e.company_id = lb.company_id AND e.id = lb.employee_id
      JOIN leave_types lt ON lt.company_id = lb.company_id AND lt.id = lb.leave_type_id
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        lt.name AS "leaveType",
        lb.period_key AS "periodKey",
        lb.opening::float AS "opening",
        lb.accrued::float AS "accrued",
        lb.used::float AS "used",
        lb.adjusted::float AS "adjusted",
        lb.pending::float AS "pending",
        lb.closing::float AS "closing"
      FROM leave_balances lb
      JOIN employees e ON e.company_id = lb.company_id AND e.id = lb.employee_id
      JOIN leave_types lt ON lt.company_id = lb.company_id AND lt.id = lb.leave_type_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY e.emp_code ASC, lt.name ASC
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
 * Filter schema for leave usage report.
 */
export const leaveUsageFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'cancelled']).optional(),
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 366;
}, { message: 'Date range cannot exceed 366 days' });

export type LeaveUsageFilters = z.infer<typeof leaveUsageFilterSchema>;

/**
 * Leave Usage Report Definition (Report 6)
 */
export const leaveUsageReport: ReportDefinition<LeaveUsageFilters> = {
  key: 'leave_usage',
  title: 'Leave Usage Report',
  description: 'Detailed log and distribution of taken, pending, and approved leave applications',
  category: 'leave',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: leaveUsageFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'leaveType', header: 'Leave Type', type: 'string', align: 'left' },
    { key: 'fromDate', header: 'From Date', type: 'date', align: 'center' },
    { key: 'toDate', header: 'To Date', type: 'date', align: 'center' },
    { key: 'days', header: 'Days', type: 'number', align: 'right' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'reason', header: 'Reason', type: 'string', align: 'left' },
    { key: 'appliedAt', header: 'Applied At', type: 'date', align: 'center' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  maxDateRangeDays: 366,
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: LeaveUsageFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = [
      'lr.company_id = $1',
      'lr.from_date <= $3',
      'lr.to_date >= $2',
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

    if (filters.leaveTypeId) {
      conditions.push(`lr.leave_type_id = $${paramIndex}`);
      values.push(filters.leaveTypeId);
      paramIndex++;
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push(`lr.status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM leave_requests lr
      JOIN employees e ON e.company_id = lr.company_id AND e.id = lr.employee_id
      JOIN leave_types lt ON lt.company_id = lr.company_id AND lt.id = lr.leave_type_id
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        lt.name AS "leaveType",
        TO_CHAR(lr.from_date, 'YYYY-MM-DD') AS "fromDate",
        TO_CHAR(lr.to_date, 'YYYY-MM-DD') AS "toDate",
        lr.days::float AS "days",
        lr.status,
        lr.reason,
        TO_CHAR(lr.created_at, 'YYYY-MM-DD HH24:MI') AS "appliedAt"
      FROM leave_requests lr
      JOIN employees e ON e.company_id = lr.company_id AND e.id = lr.employee_id
      JOIN leave_types lt ON lt.company_id = lr.company_id AND lt.id = lr.leave_type_id
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      WHERE ${whereClause}
      ORDER BY lr.created_at DESC
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
 * Filter schema for headcount report.
 */
export const headcountFilterSchema = z.object({
  departmentId: z.string().uuid().optional(),
  employmentType: z.enum(['all', 'full_time', 'part_time', 'contract', 'intern']).optional(),
  status: z.enum(['all', 'draft', 'active', 'probation', 'notice', 'terminated']).optional(),
});

export type HeadcountFilters = z.infer<typeof headcountFilterSchema>;

/**
 * Headcount Report Definition (Report 7)
 */
export const headcountReport: ReportDefinition<HeadcountFilters> = {
  key: 'headcount',
  title: 'Headcount & Staffing Report',
  description: 'Workforce breakdown across departments, designations, work locations, and employment types',
  category: 'headcount',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: headcountFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'designation', header: 'Designation', type: 'string', align: 'left' },
    { key: 'location', header: 'Location', type: 'string', align: 'left' },
    { key: 'employmentType', header: 'Type', type: 'badge', align: 'center' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'gender', header: 'Gender', type: 'string', align: 'center' },
    { key: 'doj', header: 'Joining Date', type: 'date', align: 'center' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: HeadcountFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = ['e.company_id = $1', 'e.deleted_at IS NULL'];
    const values: unknown[] = [ctx.companyId];
    let paramIndex = 2;

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

    if (filters.employmentType && filters.employmentType !== 'all') {
      conditions.push(`e.employment_type = $${paramIndex}`);
      values.push(filters.employmentType);
      paramIndex++;
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push(`e.status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM employees e
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        COALESCE(des.name, 'Unassigned') AS "designation",
        COALESCE(loc.name, 'HQ') AS "location",
        e.employment_type AS "employmentType",
        e.status,
        COALESCE(e.gender, 'Not specified') AS "gender",
        e.doj
      FROM employees e
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      LEFT JOIN designations des ON des.company_id = e.company_id AND des.id = e.designation_id
      LEFT JOIN work_locations loc ON loc.company_id = e.company_id AND loc.id = e.location_id
      WHERE ${whereClause}
      ORDER BY e.emp_code ASC
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
 * Filter schema for joiners and leavers report.
 */
export const joinersAndLeaversFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  departmentId: z.string().uuid().optional(),
  eventType: z.enum(['all', 'joiner', 'leaver']).optional(),
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 366;
}, { message: 'Date range cannot exceed 366 days' });

export type JoinersAndLeaversFilters = z.infer<typeof joinersAndLeaversFilterSchema>;

/**
 * Joiners and Leavers Report Definition (Report 8)
 */
export const joinersAndLeaversReport: ReportDefinition<JoinersAndLeaversFilters> = {
  key: 'joiners_and_leavers',
  title: 'Joiners & Leavers Report',
  description: 'Employee onboarding, exits, relieving dates, and tenure analytics',
  category: 'headcount',
  permission: PERMISSIONS.REPORT_RUN,
  filtersSchema: joinersAndLeaversFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'designation', header: 'Designation', type: 'string', align: 'left' },
    { key: 'eventType', header: 'Event', type: 'badge', align: 'center' },
    { key: 'eventDate', header: 'Event Date', type: 'date', align: 'center' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'tenureMonths', header: 'Tenure (Months)', type: 'number', align: 'right' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  maxDateRangeDays: 366,
  exports: ['csv', 'xlsx'],
  builder: async (ctx: RequestContext, filters: JoinersAndLeaversFilters, client: pg.PoolClient | pg.Pool, pagination) => {
    const conditions: string[] = ['e.company_id = $1'];
    const values: unknown[] = [ctx.companyId];
    let paramIndex = 2;

    const startDate = filters.startDate;
    const endDate = filters.endDate;
    const eventType = filters.eventType || 'all';

    if (eventType === 'joiner') {
      conditions.push(`e.doj::date >= $${paramIndex}::date AND e.doj::date <= $${paramIndex + 1}::date`);
      values.push(startDate, endDate);
      paramIndex += 2;
    } else if (eventType === 'leaver') {
      conditions.push(`(e.status = 'terminated' OR e.deleted_at IS NOT NULL)`);
      conditions.push(`COALESCE(e.deleted_at, e.updated_at)::date >= $${paramIndex}::date AND COALESCE(e.deleted_at, e.updated_at)::date <= $${paramIndex + 1}::date`);
      values.push(startDate, endDate);
      paramIndex += 2;
    } else {
      conditions.push(`((e.doj::date >= $${paramIndex}::date AND e.doj::date <= $${paramIndex + 1}::date) OR ((e.status = 'terminated' OR e.deleted_at IS NOT NULL) AND COALESCE(e.deleted_at, e.updated_at)::date >= $${paramIndex}::date AND COALESCE(e.deleted_at, e.updated_at)::date <= $${paramIndex + 1}::date))`);
      values.push(startDate, endDate);
      paramIndex += 2;
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

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM employees e
      WHERE ${whereClause}
    `;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code AS "empCode",
        CONCAT(e.first_name, ' ', e.last_name) AS "name",
        COALESCE(d.name, 'Unassigned') AS "department",
        COALESCE(des.name, 'Unassigned') AS "designation",
        CASE 
          WHEN e.status = 'terminated' OR e.deleted_at IS NOT NULL THEN 'Leaver'
          ELSE 'Joiner'
        END AS "eventType",
        CASE 
          WHEN e.status = 'terminated' OR e.deleted_at IS NOT NULL THEN TO_CHAR(COALESCE(e.deleted_at, e.updated_at), 'YYYY-MM-DD')
          ELSE TO_CHAR(e.doj, 'YYYY-MM-DD')
        END AS "eventDate",
        e.status,
        ROUND((EXTRACT(EPOCH FROM (COALESCE(e.deleted_at, CURRENT_TIMESTAMP) - e.doj::timestamptz)) / (86400 * 30.4375))::numeric, 1)::float AS "tenureMonths"
      FROM employees e
      LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
      LEFT JOIN designations des ON des.company_id = e.company_id AND des.id = e.designation_id
      WHERE ${whereClause}
      ORDER BY "eventDate" DESC, e.emp_code ASC
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
    // Register all 8 core reports for Phase 3
    this.register(attendanceSummaryReport as unknown as ReportDefinition);
    this.register(dailyAttendanceRegisterReport as unknown as ReportDefinition);
    this.register(lateMarksAndAbsenteeismReport as unknown as ReportDefinition);
    this.register(attendanceExceptionsReport as unknown as ReportDefinition);
    this.register(leaveBalancesReport as unknown as ReportDefinition);
    this.register(leaveUsageReport as unknown as ReportDefinition);
    this.register(headcountReport as unknown as ReportDefinition);
    this.register(joinersAndLeaversReport as unknown as ReportDefinition);

    // Register 10 payroll reports for Phase 4 (P4-REP-01)
    this.register(payrollRegisterReport as unknown as ReportDefinition);
    this.register(payrollVarianceReport as unknown as ReportDefinition);
    this.register(departmentCostReport as unknown as ReportDefinition);
    this.register(bankSummaryReport as unknown as ReportDefinition);
    this.register(statutorySummaryReport as unknown as ReportDefinition);
    this.register(ytdLedgerReport as unknown as ReportDefinition);
    this.register(joinersExitsImpactReport as unknown as ReportDefinition);
    this.register(payslipDistributionReport as unknown as ReportDefinition);
    this.register(ctcVsGrossReconReport as unknown as ReportDefinition);
    this.register(gratuityProvisionReport as unknown as ReportDefinition);
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

