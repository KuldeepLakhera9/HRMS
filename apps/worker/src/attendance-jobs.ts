import type pg from 'pg';
import { getOwnerPool, withTenant, generateUuidV7 } from '@hrms/db';
import {
  AttendanceDayService,
  AttendancePolicyRepository,
  AttendanceLockService,
} from '@hrms/core';

export interface CloseDayJobPayload {
  companyId: string;
  workDate: string; // YYYY-MM-DD
}

export interface RecomputeDayJobPayload {
  companyId: string;
  employeeId: string;
  workDate: string;
}

export interface AutoPunchOutJobPayload {
  companyId: string;
}

export interface SelfieRetentionJobPayload {
  companyId: string;
  retentionDays?: number;
}

/**
 * Worker jobs for attendance day lifecycle, auto punch-out, and selfie retention.
 */
export class AttendanceWorkerJobs {
  readonly dayService: AttendanceDayService;
  readonly policyRepo: AttendancePolicyRepository;
  readonly lockService: AttendanceLockService;

  constructor(
    dayService?: AttendanceDayService,
    policyRepo?: AttendancePolicyRepository,
    lockService?: AttendanceLockService,
  ) {
    this.dayService = dayService ?? new AttendanceDayService();
    this.policyRepo = policyRepo ?? new AttendancePolicyRepository();
    this.lockService = lockService ?? new AttendanceLockService();
  }

  /**
   * attendance.close_day: Batched closure of attendance in chunks of 500 employees.
   */
  async handleCloseDay(payload: CloseDayJobPayload, poolOverride?: pg.Pool): Promise<{ totalEmployees: number; totalUpdated: number }> {
    return this.dayService.closeDayBatch(payload.companyId, payload.workDate, 500, poolOverride);
  }

  /**
   * attendance.recompute_day: On-demand recalculation of an attendance day.
   */
  async handleRecomputeDay(payload: RecomputeDayJobPayload, poolOverride?: pg.Pool): Promise<void> {
    const ctx = {
      companyId: payload.companyId,
      userId: 'system_worker',
      roles: ['super_admin'],
      permissions: ['attendance.day.recalculate'],
      isAuthenticated: true,
      requestId: `job-recompute-${Date.now()}`,
    };

    await this.dayService.recomputeDay(ctx, payload.employeeId, payload.workDate, poolOverride);
  }

  /**
   * attendance.auto_punch_out: Scans open IN presences exceeding policy auto_punch_out_hours.
   */
  async handleAutoPunchOut(payload: AutoPunchOutJobPayload, poolOverride?: pg.Pool): Promise<{ autoOutCount: number }> {
    const pool = poolOverride ?? getOwnerPool();
    const companyId = payload.companyId;

    return withTenant({ companyId }, async (_tx, client) => {
      // Find open presence exceeding 12 hours (or policy threshold)
      const expiredQuery = `
        SELECT
          p.id as "presenceId",
          p.employee_id as "employeeId",
          p.last_punch_time as "lastPunchTime",
          p.shift_date as "shiftDate",
          p.location_id as "locationId",
          COALESCE(pol.auto_punch_out_hours, 12.0) as "autoOutHours"
        FROM attendance_presence p
        LEFT JOIN employees e ON e.company_id = p.company_id AND e.id = p.employee_id
        LEFT JOIN attendance_policies pol ON pol.company_id = p.company_id AND pol.deleted_at IS NULL
        WHERE p.company_id = $1
          AND p.status = 'in'
          AND p.last_punch_time < NOW() - (COALESCE(pol.auto_punch_out_hours, 12.0) || ' hours')::interval
        LIMIT 100
      `;

      const res = await client.query<{
        presenceId: string;
        employeeId: string;
        lastPunchTime: Date;
        shiftDate: string;
        locationId: string | null;
        autoOutHours: number;
      }>(expiredQuery, [companyId]);

      let autoOutCount = 0;

      for (const row of res.rows) {
        const autoOutPunchId = generateUuidV7();
        const punchTime = new Date();

        // 1. Insert synthetic auto_out punch (append-only)
        await client.query(
          `INSERT INTO attendance_punches (
            id, company_id, employee_id, punch_time, punch_type, source,
            work_date, location_id, is_inside_geofence, status, reason_code,
            flag_reasons, idempotency_key, created_at
          ) VALUES (
            $1, $2, $3, $4, 'auto_out', 'web',
            $5, $6, true, 'valid', 'AUTO_PUNCH_OUT',
            ARRAY['AUTO_PUNCH_OUT'], $7, NOW()
          )`,
          [
            autoOutPunchId,
            companyId,
            row.employeeId,
            punchTime,
            row.shiftDate,
            row.locationId,
            `auto-out-${autoOutPunchId}`,
          ],
        );

        // 2. Update presence to 'out'
        await client.query(
          `UPDATE attendance_presence
           SET status = 'out',
               last_punch_id = $1,
               last_punch_time = $2,
               updated_at = NOW()
           WHERE company_id = $3 AND employee_id = $4`,
          [autoOutPunchId, punchTime, companyId, row.employeeId],
        );

        autoOutCount++;
      }

      return { autoOutCount };
    }, pool);
  }

  /**
   * selfie.retention_cleanup: Purges raw punch selfies older than retention threshold.
   */
  async handleSelfieRetention(payload: SelfieRetentionJobPayload, poolOverride?: pg.Pool): Promise<{ purgedCount: number }> {
    const pool = poolOverride ?? getOwnerPool();
    const retentionDays = payload.retentionDays ?? 90;
    const companyId = payload.companyId;

    return withTenant({ companyId }, async (_tx, client) => {
      // Find selfie files older than retention days
      const selectQuery = `
        SELECT DISTINCT selfie_file_id as "fileId"
        FROM attendance_punches
        WHERE company_id = $1
          AND selfie_file_id IS NOT NULL
          AND punch_time < NOW() - ($2 || ' days')::interval
        LIMIT 500
      `;

      const res = await client.query<{ fileId: string }>(selectQuery, [companyId, retentionDays]);
      const fileIds = res.rows.map(r => r.fileId);

      if (fileIds.length === 0) {
        return { purgedCount: 0 };
      }

      // Soft delete in files table
      await client.query(
        `UPDATE files
         SET deleted_at = NOW()
         WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [companyId, fileIds],
      );

      return { purgedCount: fileIds.length };
    }, pool);
  }
}
