import type pg from 'pg';
import { getAppPool, withTenant } from '@hrms/db';
import type { DayContext } from './day-engine.js';

export class DayContextProvider {
  /**
   * Resolves DayContext for a specific employee and date.
   * Checks weekly off, holidays, and approved OD / WFH workflows.
   * Query budget: 1
   */
  async getDayContext(
    companyId: string,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<DayContext> {
    const pool = poolOverride ?? getAppPool();

    return withTenant({ companyId }, async (_tx, client) => {
      // 1. Check roster weekly off & holiday
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

      const rosterRow = rosterRes.rows[0];
      const isWeeklyOff = rosterRow ? Boolean(rosterRow.isWeeklyOff) : false;
      const isHoliday = rosterRow ? Boolean(rosterRow.isHoliday) : false;

      // 2. Check approved OD or WFH workflow requests for this work date
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
      };
    }, pool);
  }
}
