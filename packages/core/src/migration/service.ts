import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import { generateUuidV7, withTenant, getAppPool } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { parseCsv, formatErrorCsv } from './parser.js';
import type {
  MigrationErrorRow,
  LeaveBalanceImportRow,
  AttendanceImportRow,
  MigrationPreviewResult,
  MigrationConfirmResult,
} from './types.js';

export class MigrationService {
  /**
   * Parses and validates a CSV of opening leave balances.
   * Format: emp_code, leave_type_code, period_year, opening_balance
   */
  async previewLeaveBalances(
    ctx: RequestContext,
    csvContent: string,
    pool?: pg.Pool,
  ): Promise<MigrationPreviewResult<LeaveBalanceImportRow>> {
    if (!can(ctx, PERMISSIONS.IMPORT_LEAVE_BALANCES)) {
      throw new ForbiddenError('You do not have permission to import leave balances');
    }

    const rawRows = parseCsv(csvContent);
    if (rawRows.length === 0) {
      throw new ValidationError('CSV file is empty or missing headers');
    }

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch tenant lookup maps
      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      const ltRes = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM leave_types WHERE company_id = $1 AND active = true AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const ltMap = new Map(ltRes.rows.map(lt => [lt.code.toUpperCase(), lt.id]));

      const errors: MigrationErrorRow[] = [];
      const validRows: LeaveBalanceImportRow[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i]!;
        const rowNum = i + 2; // account for 1-indexed and header row

        const empCode = (row.emp_code || row.empcode || row.employee_code || '').trim().toUpperCase();
        const leaveTypeCode = (row.leave_type_code || row.leave_type || row.code || '').trim().toUpperCase();
        const periodYear = (row.period_year || row.year || row.period || '').trim();
        const balanceRaw = (row.opening_balance || row.balance || row.opening || '').trim();

        if (!empCode) {
          errors.push({ rowNumber: rowNum, reason: 'Missing employee code', rawData: JSON.stringify(row) });
          continue;
        }

        if (!empMap.has(empCode)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Employee '${empCode}' not found in company`, rawData: JSON.stringify(row) });
          continue;
        }

        if (!leaveTypeCode) {
          errors.push({ rowNumber: rowNum, empCode, reason: 'Missing leave type code', rawData: JSON.stringify(row) });
          continue;
        }

        if (!ltMap.has(leaveTypeCode)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Leave type '${leaveTypeCode}' not found or inactive`, rawData: JSON.stringify(row) });
          continue;
        }

        if (!periodYear || !/^\d{4}$/.test(periodYear)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Invalid period year '${periodYear}' (must be YYYY)`, rawData: JSON.stringify(row) });
          continue;
        }

        const balance = parseFloat(balanceRaw);
        if (isNaN(balance) || balance < 0) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Invalid balance '${balanceRaw}' (must be non-negative number)`, rawData: JSON.stringify(row) });
          continue;
        }

        validRows.push({
          empCode,
          leaveTypeCode,
          periodYear,
          openingBalance: balance,
        });
      }

      // Record batch in preview status
      const batchId = generateUuidV7();
      const idempotencyKey = `migration:preview:${batchId}`;

      await client.query(
        `INSERT INTO data_migration_batches (
          id, company_id, type, status, total_rows, valid_rows, error_rows,
          errors_json, summary_json, idempotency_key, created_by, updated_by
        ) VALUES (
          $1, $2, 'leave_balances', 'preview', $3, $4, $5, $6, $7, $8, $9, $9
        )`,
        [
          batchId,
          ctx.companyId,
          rawRows.length,
          validRows.length,
          errors.length,
          JSON.stringify(errors),
          JSON.stringify({ validCount: validRows.length, validRows }),
          idempotencyKey,
          ctx.userId,
        ],
      );

      return {
        batchId,
        type: 'leave_balances',
        totalRows: rawRows.length,
        validRows: validRows.length,
        errorRows: errors.length,
        errors,
        preview: validRows.slice(0, 10),
      };
    }, pool ?? getAppPool());
  }

  /**
   * Confirms and applies opening leave balances from a previewed batch.
   * Inserts into leave_ledger and updates leave_balances with deduplication.
   */
  async confirmLeaveBalances(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<MigrationConfirmResult> {
    if (!can(ctx, PERMISSIONS.IMPORT_LEAVE_BALANCES)) {
      throw new ForbiddenError('You do not have permission to import leave balances');
    }

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch batch
      const batchRes = await client.query<{
        id: string;
        status: string;
        summary_json: { validRows: LeaveBalanceImportRow[] };
      }>(
        `SELECT id, status, summary_json
         FROM data_migration_batches
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ctx.companyId, batchId],
      );

      if (batchRes.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }

      const batch = batchRes.rows[0]!;
      if (batch.status === 'completed') {
        return {
          batchId,
          status: 'completed',
          processedCount: batch.summary_json.validRows?.length ?? 0,
          summary: batch.summary_json,
        };
      }

      if (batch.status !== 'preview') {
        throw new ConflictError(`Cannot confirm batch with status '${batch.status}'`);
      }

      const rows = batch.summary_json.validRows ?? [];

      // 2. Fetch lookups
      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      const ltRes = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM leave_types WHERE company_id = $1 AND active = true AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const ltMap = new Map(ltRes.rows.map(lt => [lt.code.toUpperCase(), lt.id]));

      let processedCount = 0;
      let totalDays = 0;

      for (const row of rows) {
        const empId = empMap.get(row.empCode);
        const leaveTypeId = ltMap.get(row.leaveTypeCode);
        if (!empId || !leaveTypeId) continue;

        const dedupeKey = `${ctx.companyId}:migration:${batchId}:${empId}:${leaveTypeId}:${row.periodYear}`;

        // 3. Ledger entry (append-only)
        const ledgerId = generateUuidV7();
        await client.query(
          `INSERT INTO leave_ledger (
            id, company_id, employee_id, leave_type_id, period_key, entry_type,
            delta_days, effective_date, ref_type, ref_id, reason, dedupe_key, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, 'opening',
            $6, $7, 'migration', $8, 'Opening balance import', $9, $10
          ) ON CONFLICT (company_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          [
            ledgerId,
            ctx.companyId,
            empId,
            leaveTypeId,
            row.periodYear,
            row.openingBalance.toFixed(3),
            `${row.periodYear}-01-01`,
            batchId,
            dedupeKey,
            ctx.userId,
          ],
        );

        // 4. Upsert leave_balances
        const balId = generateUuidV7();
        await client.query(
          `INSERT INTO leave_balances (
            id, company_id, employee_id, leave_type_id, period_key, opening, closing, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $6, $7, $7
          ) ON CONFLICT (company_id, employee_id, leave_type_id, period_key)
          DO UPDATE SET 
            opening = EXCLUDED.opening,
            closing = EXCLUDED.opening + leave_balances.accrued - leave_balances.used + leave_balances.adjusted - leave_balances.expired - leave_balances.encashed,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP`,
          [
            balId,
            ctx.companyId,
            empId,
            leaveTypeId,
            row.periodYear,
            row.openingBalance.toFixed(3),
            ctx.userId,
          ],
        );

        processedCount++;
        totalDays += row.openingBalance;
      }

      const summary = {
        ...batch.summary_json,
        processedCount,
        totalDays,
        appliedAt: new Date().toISOString(),
      };

      // 5. Update batch status
      await client.query(
        `UPDATE data_migration_batches
         SET status = 'completed',
             summary_json = $3,
             confirmed_by = $4,
             updated_by = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, batchId, JSON.stringify(summary), ctx.userId],
      );

      return {
        batchId,
        status: 'completed',
        processedCount,
        summary,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Reverts an applied opening leave balances batch by setting opening to 0 and recalculating.
   */
  async revertLeaveBalances(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<{ batchId: string; status: 'reverted'; revertedCount: number }> {
    if (!can(ctx, PERMISSIONS.IMPORT_LEAVE_BALANCES)) {
      throw new ForbiddenError('You do not have permission to import leave balances');
    }

    return withTenant(ctx, async (_tx, client) => {
      const batchRes = await client.query<{
        id: string;
        status: string;
        summary_json: { validRows: LeaveBalanceImportRow[] };
      }>(
        `SELECT id, status, summary_json
         FROM data_migration_batches
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ctx.companyId, batchId],
      );

      if (batchRes.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }

      const batch = batchRes.rows[0]!;
      if (batch.status === 'reverted') {
        throw new ConflictError('Batch has already been reverted');
      }
      if (batch.status !== 'completed') {
        throw new ConflictError(`Cannot revert batch in status '${batch.status}'`);
      }

      const rows = batch.summary_json.validRows ?? [];

      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      const ltRes = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM leave_types WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const ltMap = new Map(ltRes.rows.map(lt => [lt.code.toUpperCase(), lt.id]));

      let revertedCount = 0;

      for (const row of rows) {
        const empId = empMap.get(row.empCode);
        const leaveTypeId = ltMap.get(row.leaveTypeCode);
        if (!empId || !leaveTypeId) continue;

        const dedupeKey = `${ctx.companyId}:migration_reversal:${batchId}:${empId}:${leaveTypeId}:${row.periodYear}`;

        // 1. Insert compensating reversal entry in immutable leave_ledger
        const ledgerId = generateUuidV7();
        await client.query(
          `INSERT INTO leave_ledger (
            id, company_id, employee_id, leave_type_id, period_key, entry_type,
            delta_days, effective_date, ref_type, ref_id, reason, dedupe_key, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, 'reversal',
            $6, CURRENT_DATE, 'migration', $7, 'Reversal of opening balance migration', $8, $9
          ) ON CONFLICT (company_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          [
            ledgerId,
            ctx.companyId,
            empId,
            leaveTypeId,
            row.periodYear,
            (-row.openingBalance).toFixed(3),
            batchId,
            dedupeKey,
            ctx.userId,
          ],
        );

        // 2. Reset opening balance and subtract from closing
        await client.query(
          `UPDATE leave_balances
           SET opening = '0.000',
               closing = closing - opening,
               updated_by = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE company_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND period_key = $5`,
          [ctx.companyId, empId, leaveTypeId, ctx.userId, row.periodYear],
        );

        revertedCount++;
      }

      await client.query(
        `UPDATE data_migration_batches
         SET status = 'reverted',
             reverted_at = CURRENT_TIMESTAMP,
             updated_by = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, batchId, ctx.userId],
      );

      return {
        batchId,
        status: 'reverted',
        revertedCount,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Reverts an applied historical attendance batch by resetting modified attendance day records.
   */
  async revertAttendancePunches(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<{ batchId: string; status: 'reverted'; revertedCount: number }> {
    if (!can(ctx, PERMISSIONS.IMPORT_ATTENDANCE)) {
      throw new ForbiddenError('You do not have permission to import attendance');
    }

    return withTenant(ctx, async (_tx, client) => {
      const batchRes = await client.query<{
        id: string;
        status: string;
        summary_json: { validRows: AttendanceImportRow[] };
      }>(
        `SELECT id, status, summary_json
         FROM data_migration_batches
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ctx.companyId, batchId],
      );

      if (batchRes.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }

      const batch = batchRes.rows[0]!;
      if (batch.status === 'reverted') {
        throw new ConflictError('Batch has already been reverted');
      }
      if (batch.status !== 'completed') {
        throw new ConflictError(`Cannot revert batch in status '${batch.status}'`);
      }

      const rows = batch.summary_json.validRows ?? [];
      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      let revertedCount = 0;
      for (const row of rows) {
        const empId = empMap.get(row.empCode);
        if (!empId) continue;

        await client.query(
          `UPDATE attendance_days
           SET status = 'absent',
               total_work_minutes = 0,
               first_in = NULL,
               last_out = NULL,
               updated_by = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE company_id = $1 AND employee_id = $2 AND work_date = $3`,
          [ctx.companyId, empId, row.date, ctx.userId],
        );
        revertedCount++;
      }

      await client.query(
        `UPDATE data_migration_batches
         SET status = 'reverted',
             reverted_at = CURRENT_TIMESTAMP,
             updated_by = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, batchId, ctx.userId],
      );

      return {
        batchId,
        status: 'reverted',
        revertedCount,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Unified batch revert method that inspects batch type and executes the appropriate reversal logic.
   */
  async revertBatch(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<{ batchId: string; status: 'reverted'; revertedCount: number }> {
    const batch = await withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{ type: string }>(
        `SELECT type FROM data_migration_batches WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, batchId],
      );
      if (res.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }
      return res.rows[0]!;
    }, pool ?? getAppPool());

    if (batch.type === 'attendance_punches') {
      return this.revertAttendancePunches(ctx, batchId, pool);
    }
    return this.revertLeaveBalances(ctx, batchId, pool);
  }

  /**
   * Parses and validates a CSV of historical attendance punches / days.
   * Format: emp_code, date, in_time, out_time, status
   */
  async previewAttendance(
    ctx: RequestContext,
    csvContent: string,
    pool?: pg.Pool,
  ): Promise<MigrationPreviewResult<AttendanceImportRow>> {
    if (!can(ctx, PERMISSIONS.IMPORT_ATTENDANCE)) {
      throw new ForbiddenError('You do not have permission to import historical attendance');
    }

    const rawRows = parseCsv(csvContent);
    if (rawRows.length === 0) {
      throw new ValidationError('CSV file is empty or missing headers');
    }

    return withTenant(ctx, async (_tx, client) => {
      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      const errors: MigrationErrorRow[] = [];
      const validRows: AttendanceImportRow[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i]!;
        const rowNum = i + 2;

        const empCode = (row.emp_code || row.empcode || '').trim().toUpperCase();
        const date = (row.date || row.work_date || '').trim();
        const inTime = (row.in_time || row.intime || row.first_in || '').trim() || null;
        const outTime = (row.out_time || row.outtime || row.last_out || '').trim() || null;
        const status = (row.status || 'present').trim().toLowerCase();

        if (!empCode) {
          errors.push({ rowNumber: rowNum, reason: 'Missing employee code', rawData: JSON.stringify(row) });
          continue;
        }

        if (!empMap.has(empCode)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Employee '${empCode}' not found`, rawData: JSON.stringify(row) });
          continue;
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Invalid date '${date}' (must be YYYY-MM-DD)`, rawData: JSON.stringify(row) });
          continue;
        }

        const validStatuses = ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off'];
        if (!validStatuses.includes(status)) {
          errors.push({ rowNumber: rowNum, empCode, reason: `Invalid status '${status}'`, rawData: JSON.stringify(row) });
          continue;
        }

        validRows.push({
          empCode,
          date,
          inTime,
          outTime,
          status,
        });
      }

      const batchId = generateUuidV7();
      const idempotencyKey = `migration:preview:att:${batchId}`;

      await client.query(
        `INSERT INTO data_migration_batches (
          id, company_id, type, status, total_rows, valid_rows, error_rows,
          errors_json, summary_json, idempotency_key, created_by, updated_by
        ) VALUES (
          $1, $2, 'attendance_punches', 'preview', $3, $4, $5, $6, $7, $8, $9, $9
        )`,
        [
          batchId,
          ctx.companyId,
          rawRows.length,
          validRows.length,
          errors.length,
          JSON.stringify(errors),
          JSON.stringify({ validCount: validRows.length, validRows }),
          idempotencyKey,
          ctx.userId,
        ],
      );

      return {
        batchId,
        type: 'attendance_punches',
        totalRows: rawRows.length,
        validRows: validRows.length,
        errorRows: errors.length,
        errors,
        preview: validRows.slice(0, 10),
      };
    }, pool ?? getAppPool());
  }

  /**
   * Confirms and applies historical attendance records into attendance_days and summary.
   */
  async confirmAttendance(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<MigrationConfirmResult> {
    if (!can(ctx, PERMISSIONS.IMPORT_ATTENDANCE)) {
      throw new ForbiddenError('You do not have permission to import historical attendance');
    }

    return withTenant(ctx, async (_tx, client) => {
      const batchRes = await client.query<{
        id: string;
        status: string;
        summary_json: { validRows: AttendanceImportRow[] };
      }>(
        `SELECT id, status, summary_json
         FROM data_migration_batches
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ctx.companyId, batchId],
      );

      if (batchRes.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }

      const batch = batchRes.rows[0]!;
      if (batch.status === 'completed') {
        return {
          batchId,
          status: 'completed',
          processedCount: batch.summary_json.validRows?.length ?? 0,
          summary: batch.summary_json,
        };
      }

      if (batch.status !== 'preview') {
        throw new ConflictError(`Cannot confirm batch in status '${batch.status}'`);
      }

      const rows = batch.summary_json.validRows ?? [];

      const empRes = await client.query<{ id: string; emp_code: string }>(
        `SELECT id, emp_code FROM employees WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const empMap = new Map(empRes.rows.map(e => [e.emp_code.toUpperCase(), e.id]));

      let processedCount = 0;
      let missingPunchesCount = 0;

      for (const row of rows) {
        const empId = empMap.get(row.empCode);
        if (!empId) continue;

        let firstIn: string | null = null;
        let lastOut: string | null = null;
        let workMinutes = 0;

        if (row.inTime) {
          firstIn = `${row.date} ${row.inTime.length === 5 ? row.inTime + ':00' : row.inTime}`;
        }
        if (row.outTime) {
          lastOut = `${row.date} ${row.outTime.length === 5 ? row.outTime + ':00' : row.outTime}`;
        }

        if (firstIn && lastOut) {
          const inDate = new Date(firstIn);
          const outDate = new Date(lastOut);
          workMinutes = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
        } else if (firstIn || lastOut) {
          missingPunchesCount++;
        }

        const dayId = generateUuidV7();
        await client.query(
          `INSERT INTO attendance_days (
            id, company_id, employee_id, work_date, status, total_work_minutes,
            first_in, last_out, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
          ) ON CONFLICT (company_id, employee_id, work_date)
          DO UPDATE SET 
            status = EXCLUDED.status,
            total_work_minutes = EXCLUDED.total_work_minutes,
            first_in = EXCLUDED.first_in,
            last_out = EXCLUDED.last_out,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP`,
          [
            dayId,
            ctx.companyId,
            empId,
            row.date,
            row.status || 'present',
            workMinutes,
            firstIn,
            lastOut,
            ctx.userId,
          ],
        );

        processedCount++;
      }

      const summary = {
        ...batch.summary_json,
        processedCount,
        missingPunchesCount,
        appliedAt: new Date().toISOString(),
      };

      await client.query(
        `UPDATE data_migration_batches
         SET status = 'completed',
             summary_json = $3,
             confirmed_by = $4,
             updated_by = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, batchId, JSON.stringify(summary), ctx.userId],
      );

      return {
        batchId,
        status: 'completed',
        processedCount,
        summary,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Generates error CSV string for download for a given batch.
   */
  async getBatchErrorCsv(
    ctx: RequestContext,
    batchId: string,
    pool?: pg.Pool,
  ): Promise<string> {
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{ errors_json: MigrationErrorRow[] }>(
        `SELECT errors_json FROM data_migration_batches 
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, batchId],
      );

      if (res.rows.length === 0) {
        throw new NotFoundError('Migration batch not found');
      }

      return formatErrorCsv(res.rows[0]!.errors_json || []);
    }, pool ?? getAppPool());
  }

  /**
   * Lists past migration batches for the company.
   */
  async listBatches(
    ctx: RequestContext,
    pool?: pg.Pool,
  ): Promise<Array<{
    id: string;
    type: string;
    status: string;
    totalRows: number;
    validRows: number;
    errorRows: number;
    createdAt: Date;
    revertedAt: Date | null;
  }>> {
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{
        id: string;
        type: string;
        status: string;
        total_rows: number;
        valid_rows: number;
        error_rows: number;
        created_at: Date;
        reverted_at: Date | null;
      }>(
        `SELECT 
          id, type, status,
          total_rows AS "total_rows",
          valid_rows AS "valid_rows",
          error_rows AS "error_rows",
          created_at AS "created_at",
          reverted_at AS "reverted_at"
        FROM data_migration_batches
        WHERE company_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
        [ctx.companyId],
      );

      return res.rows.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        totalRows: r.total_rows,
        validRows: r.valid_rows,
        errorRows: r.error_rows,
        createdAt: r.created_at,
        revertedAt: r.reverted_at,
      }));
    }, pool ?? getAppPool());
  }
}
