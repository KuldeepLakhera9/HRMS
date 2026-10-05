import type pg from 'pg';
import { DateTime } from 'luxon';
import { getAppPool, withTenant } from '@hrms/db';
import type { DayContext } from './day-engine.js';
import { isWeeklyOffDate } from '../leave/compute-leave-days.js';
import { HolidayService } from '../leave/holiday-service.js';

export class DayContextProvider {
  private holidayService: HolidayService;

  constructor(holidayService?: HolidayService) {
    this.holidayService = holidayService ?? new HolidayService();
  }

  /**
   * Resolves DayContext for a specific employee and date (P3-INT-01).
   * Checks weekly off, holidays, approved leave, and approved OD / WFH workflows.
   */
  async getDayContext(
    companyId: string,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<DayContext> {
    const pool = poolOverride ?? getAppPool();

    return withTenant({ companyId }, async (_tx, client) => {
      // 1. Check roster weekly off & holiday override
      const rosterRes = await client.query<{
        isWeeklyOff: boolean;
        isHoliday: boolean;
      }>(
        `SELECT
           COALESCE(is_weekly_off, false) as "isWeeklyOff",
           COALESCE(is_holiday, false) as "isHoliday"
         FROM rosters
         WHERE company_id = $1 AND employee_id = $2 AND work_date = $3::date AND deleted_at IS NULL
         LIMIT 1`,
        [companyId, employeeId, workDate],
      );

      let isWeeklyOff = false;
      let isHoliday = false;
      let holidayId: string | null = null;

      if (rosterRes.rows.length > 0 && rosterRes.rows[0]) {
        isWeeklyOff = Boolean(rosterRes.rows[0].isWeeklyOff);
        isHoliday = Boolean(rosterRes.rows[0].isHoliday);
      } else {
        // Fallback to employee shift weekly off rules and holiday lists
        const empRes = await client.query<{
          location_id: string | null;
          weekly_off_rules: Array<{ day: number; weeks?: number[] }> | null;
        }>(
          `SELECT
             e.location_id,
             s.weekly_off_rules
           FROM employees e
           LEFT JOIN shifts s ON s.company_id = e.company_id AND s.id = e.shift_id
           WHERE e.company_id = $1 AND e.id = $2 AND e.deleted_at IS NULL
           LIMIT 1`,
          [companyId, employeeId],
        );

        const emp = empRes.rows[0];
        const dt = DateTime.fromISO(workDate);
        if (emp && dt.isValid) {
          isWeeklyOff = isWeeklyOffDate(dt, emp.weekly_off_rules ?? undefined);
        }

        // Check real holidays
        const holidays = await this.holidayService.resolveHolidaysForEmployee(
          companyId,
          emp?.location_id,
          workDate,
          workDate,
          client,
        );

        if (holidays.length > 0 && holidays[0]) {
          isHoliday = true;
          holidayId = holidays[0].id;
        }
      }

      // 2. Check approved leave on this date
      const leaveRes = await client.query<{
        days: string;
        is_paid: boolean;
      }>(
        `SELECT days, is_paid
         FROM leave_request_days
         WHERE company_id = $1
           AND employee_id = $2
           AND leave_date = $3::date
           AND status = 'approved'
         LIMIT 1`,
        [companyId, employeeId, workDate],
      );

      let leavePortion = 0;
      let isPaidLeave = true;

      if (leaveRes.rows.length > 0 && leaveRes.rows[0]) {
        leavePortion = parseFloat(leaveRes.rows[0].days);
        isPaidLeave = Boolean(leaveRes.rows[0].is_paid);
      }

      // 3. Check approved OD or WFH workflow requests for this work date
      const wfRes = await client.query<{
        entityType: string;
      }>(
        `SELECT entity_type as "entityType"
         FROM workflow_requests
         WHERE company_id = $1
           AND requester_id = $2
           AND status = 'approved'
           AND entity_type IN ('on_duty', 'work_from_home')
           AND (payload->>'date' = $3 OR payload->>'workDate' = $3)
           AND deleted_at IS NULL
         LIMIT 2`,
        [companyId, employeeId, workDate],
      );

      const isApprovedOD = wfRes.rows.some(r => r.entityType === 'on_duty');
      const isApprovedWFH = wfRes.rows.some(r => r.entityType === 'work_from_home');

      return {
        isWeeklyOff,
        isHoliday,
        isApprovedOD,
        isApprovedWFH,
        leavePortion,
        isPaidLeave,
        holidayId,
      };
    }, pool);
  }
}
