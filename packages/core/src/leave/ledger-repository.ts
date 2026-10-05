import type pg from 'pg';
import { generateUuidV7, type LeaveLedgerEntry } from '@hrms/db';

export interface RecordLedgerEntryInput {
  employeeId: string;
  leaveTypeId: string;
  periodKey: string;
  entryType:
    | 'opening'
    | 'accrual'
    | 'carry_forward'
    | 'expiry'
    | 'usage'
    | 'reversal'
    | 'adjustment'
    | 'encashment';
  deltaDays: number;
  effectiveDate: string; // 'YYYY-MM-DD'
  refType?: string | null | undefined;
  refId?: string | null | undefined;
  reason?: string | null | undefined;
  meta?: Record<string, unknown> | undefined;
  dedupeKey?: string | null | undefined;
  createdBy: string;
}

export class LeaveLedgerRepository {
  /**
   * Appends an immutable ledger entry.
   * Leverages dedupe_key uniqueness to prevent double-crediting.
   */
  async recordEntry(
    companyId: string,
    input: RecordLedgerEntryInput,
    client: pg.PoolClient,
  ): Promise<LeaveLedgerEntry> {
    const id = generateUuidV7();

    // If dedupeKey is provided, check if it already exists
    if (input.dedupeKey) {
      const existing = await client.query<LeaveLedgerEntry>(
        `SELECT *
         FROM leave_ledger
         WHERE company_id = $1 AND dedupe_key = $2
         LIMIT 1`,
        [companyId, input.dedupeKey],
      );
      if (existing.rows.length > 0 && existing.rows[0]) {
        return existing.rows[0];
      }
    }

    const res = await client.query<LeaveLedgerEntry>(
      `INSERT INTO leave_ledger (
        id, company_id, employee_id, leave_type_id, period_key, entry_type,
        delta_days, effective_date, ref_type, ref_id, reason, meta,
        dedupe_key, created_by, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, now()
      )
      RETURNING *`,
      [
        id,
        companyId,
        input.employeeId,
        input.leaveTypeId,
        input.periodKey,
        input.entryType,
        input.deltaDays,
        input.effectiveDate,
        input.refType ?? null,
        input.refId ?? null,
        input.reason ?? null,
        JSON.stringify(input.meta ?? {}),
        input.dedupeKey ?? null,
        input.createdBy,
      ],
    );

    return res.rows[0]!;
  }

  /**
   * Sums all delta_days for an employee, leave type, and period.
   * Ground truth for balance reconciliation.
   */
  async getLedgerSum(
    companyId: string,
    employeeId: string,
    leaveTypeId: string,
    periodKey: string,
    client: pg.PoolClient,
  ): Promise<number> {
    const res = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(delta_days), 0) as total
       FROM leave_ledger
       WHERE company_id = $1
         AND employee_id = $2
         AND leave_type_id = $3
         AND period_key = $4`,
      [companyId, employeeId, leaveTypeId, periodKey],
    );

    return parseFloat(res.rows[0]?.total ?? '0');
  }

  /**
   * Lists ledger entries for an employee.
   */
  async listEntries(
    companyId: string,
    employeeId: string,
    options: {
      leaveTypeId?: string;
      periodKey?: string;
      limit?: number;
    },
    client: pg.PoolClient,
  ): Promise<LeaveLedgerEntry[]> {
    const conditions: string[] = ['company_id = $1', 'employee_id = $2'];
    const values: unknown[] = [companyId, employeeId];
    let pIdx = 3;

    if (options.leaveTypeId) {
      conditions.push(`leave_type_id = $${pIdx++}`);
      values.push(options.leaveTypeId);
    }
    if (options.periodKey) {
      conditions.push(`period_key = $${pIdx++}`);
      values.push(options.periodKey);
    }

    const limit = Math.min(options.limit ?? 100, 100);

    const query = `
      SELECT *
      FROM leave_ledger
      WHERE ${conditions.join(' AND ')}
      ORDER BY effective_date DESC, created_at DESC
      LIMIT ${limit}
    `;

    const res = await client.query<{
      id: string;
      company_id: string;
      employee_id: string;
      leave_type_id: string;
      period_key: string;
      entry_type: string;
      delta_days: string;
      effective_date: string;
      ref_type: string | null;
      ref_id: string | null;
      reason: string | null;
      meta: Record<string, unknown>;
      dedupe_key: string | null;
      created_by: string;
      created_at: Date;
    }>(query, values);

    return res.rows.map(r => ({
      id: r.id,
      companyId: r.company_id,
      employeeId: r.employee_id,
      leaveTypeId: r.leave_type_id,
      periodKey: r.period_key,
      entryType: r.entry_type as LeaveLedgerEntry['entryType'],
      deltaDays: r.delta_days,
      effectiveDate: r.effective_date,
      refType: r.ref_type,
      refId: r.ref_id,
      reason: r.reason,
      meta: r.meta,
      dedupeKey: r.dedupe_key,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  }
}
