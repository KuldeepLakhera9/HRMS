import type pg from 'pg';
import { getAppPool, withTenant, generateUuidV7, attendanceDays, type AttendanceDay, type NewAttendanceDay } from '@hrms/db';
import { eq, and, sql, isNull } from 'drizzle-orm';

export class AttendanceDayRepository {
  /**
   * Retrieves a single day attendance record for an employee.
   * Query budget: 1
   */
  async getDay(
    companyId: string,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendanceDay | null> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.companyId, companyId),
            eq(attendanceDays.employeeId, employeeId),
            eq(attendanceDays.workDate, workDate),
            isNull(attendanceDays.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    }, pool);
  }

  /**
   * Upserts an attendance day record.
   */
  async upsertDay(
    companyId: string,
    data: Omit<NewAttendanceDay, 'id' | 'companyId'>,
    poolOverride?: pg.Pool,
  ): Promise<AttendanceDay> {
    const pool = poolOverride ?? getAppPool();
    const id = generateUuidV7();

    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .insert(attendanceDays)
        .values({
          ...data,
          id,
          companyId,
        })
        .onConflictDoUpdate({
          target: [attendanceDays.companyId, attendanceDays.employeeId, attendanceDays.workDate],
          set: {
            shiftId: data.shiftId,
            firstIn: data.firstIn,
            lastOut: data.lastOut,
            punchCount: data.punchCount,
            totalWorkMinutes: data.totalWorkMinutes,
            effectiveMinutes: data.effectiveMinutes,
            lateInMinutes: data.lateInMinutes,
            earlyOutMinutes: data.earlyOutMinutes,
            overtimeMinutes: data.overtimeMinutes,
            status: data.status,
            isRegularized: data.isRegularized,
            isLocked: data.isLocked,
            ruleVersion: data.ruleVersion,
            sourceHash: data.sourceHash,
            updatedBy: data.updatedBy,
            updatedAt: new Date(),
          },
        })
        .returning();

      return rows[0]!;
    }, pool);
  }

  /**
   * Performs bulk upsert of multiple attendance days with source_hash change check.
   * Only rows where source_hash is distinct are updated.
   */
  async batchUpsertDays(
    companyId: string,
    days: Array<Omit<NewAttendanceDay, 'id' | 'companyId'>>,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    if (days.length === 0) return 0;
    const pool = poolOverride ?? getAppPool();

    return withTenant({ companyId }, async (_tx, client) => {
      // Chunk in groups of 100 for parameter safety
      const chunkSize = 100;
      let totalUpdated = 0;

      for (let i = 0; i < days.length; i += chunkSize) {
        const chunk = days.slice(i, i + chunkSize);
        const valueStrings: string[] = [];
        const params: unknown[] = [companyId];

        for (const d of chunk) {
          const id = generateUuidV7();
          const baseIdx = params.length + 1;
          valueStrings.push(
            `($${baseIdx}, $1, $${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8}, $${baseIdx + 9}, $${baseIdx + 10}, $${baseIdx + 11}, $${baseIdx + 12}, $${baseIdx + 13}, $${baseIdx + 14}, $${baseIdx + 15}, $${baseIdx + 16}, $${baseIdx + 17})`
          );
          params.push(
            id,
            d.employeeId,
            d.workDate,
            d.shiftId ?? null,
            d.firstIn ?? null,
            d.lastOut ?? null,
            d.punchCount ?? 0,
            d.totalWorkMinutes ?? 0,
            d.effectiveMinutes ?? 0,
            d.lateInMinutes ?? 0,
            d.earlyOutMinutes ?? 0,
            d.overtimeMinutes ?? 0,
            d.status ?? 'absent',
            d.isRegularized ?? false,
            d.ruleVersion ?? 1,
            d.sourceHash ?? null,
            d.createdBy,
            d.updatedBy,
          );
        }

        const sqlStr = `
          INSERT INTO attendance_days (
            id, company_id, employee_id, work_date, shift_id,
            first_in, last_out, punch_count, total_work_minutes, effective_minutes,
            late_in_minutes, early_out_minutes, overtime_minutes, status,
            is_regularized, rule_version, source_hash, created_by, updated_by
          ) VALUES ${valueStrings.join(', ')}
          ON CONFLICT (company_id, employee_id, work_date)
          DO UPDATE SET
            shift_id = EXCLUDED.shift_id,
            first_in = EXCLUDED.first_in,
            last_out = EXCLUDED.last_out,
            punch_count = EXCLUDED.punch_count,
            total_work_minutes = EXCLUDED.total_work_minutes,
            effective_minutes = EXCLUDED.effective_minutes,
            late_in_minutes = EXCLUDED.late_in_minutes,
            early_out_minutes = EXCLUDED.early_out_minutes,
            overtime_minutes = EXCLUDED.overtime_minutes,
            status = EXCLUDED.status,
            is_regularized = EXCLUDED.is_regularized,
            rule_version = EXCLUDED.rule_version,
            source_hash = EXCLUDED.source_hash,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
          WHERE attendance_days.source_hash IS DISTINCT FROM EXCLUDED.source_hash
          RETURNING id
        `;

        const res = await client.query(sqlStr, params);
        totalUpdated += res.rowCount ?? 0;
      }

      return totalUpdated;
    }, pool);
  }

  /**
   * Lists attendance days for an employee across a date range.
   */
  async listDays(
    companyId: string,
    employeeId: string,
    startDate: string,
    endDate: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendanceDay[]> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      return tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.companyId, companyId),
            eq(attendanceDays.employeeId, employeeId),
            sql`${attendanceDays.workDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
            isNull(attendanceDays.deletedAt),
          ),
        )
        .orderBy(sql`${attendanceDays.workDate} ASC`);
    }, pool);
  }
}
