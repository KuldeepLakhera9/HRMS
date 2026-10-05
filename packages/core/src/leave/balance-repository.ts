import type pg from 'pg';
import { generateUuidV7, type LeaveBalance } from '@hrms/db';

export interface UpdateBalanceInput {
  opening?: number | undefined;
  accrued?: number | undefined;
  used?: number | undefined;
  adjusted?: number | undefined;
  expired?: number | undefined;
  encashed?: number | undefined;
  pending?: number | undefined;
}

export class LeaveBalanceRepository {
  /**
   * Retrieves an existing leave balance row or creates a new zeroed row.
   */
  async getOrCreateBalance(
    companyId: string,
    employeeId: string,
    leaveTypeId: string,
    periodKey: string,
    client: pg.PoolClient,
  ): Promise<LeaveBalance> {
    const existing = await client.query<LeaveBalance>(
      `SELECT *
       FROM leave_balances
       WHERE company_id = $1
         AND employee_id = $2
         AND leave_type_id = $3
         AND period_key = $4
       LIMIT 1`,
      [companyId, employeeId, leaveTypeId, periodKey],
    );

    if (existing.rows.length > 0 && existing.rows[0]) {
      return existing.rows[0];
    }

    const id = generateUuidV7();
    const res = await client.query<LeaveBalance>(
      `INSERT INTO leave_balances (
        id, company_id, employee_id, leave_type_id, period_key,
        opening, accrued, used, adjusted, expired, encashed, pending, closing,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
        now(), now()
      )
      ON CONFLICT (company_id, employee_id, leave_type_id, period_key)
      DO UPDATE SET updated_at = now()
      RETURNING *`,
      [id, companyId, employeeId, leaveTypeId, periodKey],
    );

    return res.rows[0]!;
  }

  /**
   * Acquires a row-level lock (FOR UPDATE) on the balance row.
   * Prevents race conditions and balance overdraft under concurrency.
   */
  async lockBalanceForUpdate(
    companyId: string,
    employeeId: string,
    leaveTypeId: string,
    periodKey: string,
    client: pg.PoolClient,
  ): Promise<LeaveBalance> {
    // First ensure the row exists so FOR UPDATE has a row to lock
    await this.getOrCreateBalance(companyId, employeeId, leaveTypeId, periodKey, client);

    const locked = await client.query<LeaveBalance>(
      `SELECT *
       FROM leave_balances
       WHERE company_id = $1
         AND employee_id = $2
         AND leave_type_id = $3
         AND period_key = $4
       FOR UPDATE`,
      [companyId, employeeId, leaveTypeId, periodKey],
    );

    return locked.rows[0]!;
  }

  /**
   * Updates balance component values while maintaining the invariant:
   * closing = opening + accrued + adjusted - used - expired - encashed.
   */
  async updateBalance(
    companyId: string,
    balanceId: string,
    updates: UpdateBalanceInput,
    client: pg.PoolClient,
  ): Promise<LeaveBalance> {
    const currentRes = await client.query<LeaveBalance>(
      `SELECT *
       FROM leave_balances
       WHERE company_id = $1 AND id = $2
       LIMIT 1`,
      [companyId, balanceId],
    );

    const current = currentRes.rows[0];
    if (!current) {
      throw new Error(`Leave balance record ${balanceId} not found.`);
    }

    const opening = updates.opening !== undefined ? updates.opening : parseFloat(current.opening);
    const accrued = updates.accrued !== undefined ? updates.accrued : parseFloat(current.accrued);
    const used = updates.used !== undefined ? updates.used : parseFloat(current.used);
    const adjusted = updates.adjusted !== undefined ? updates.adjusted : parseFloat(current.adjusted);
    const expired = updates.expired !== undefined ? updates.expired : parseFloat(current.expired);
    const encashed = updates.encashed !== undefined ? updates.encashed : parseFloat(current.encashed);
    const pending = updates.pending !== undefined ? updates.pending : parseFloat(current.pending);

    // Enforce invariant
    const closing = Math.round((opening + accrued + adjusted - used - expired - encashed) * 1000) / 1000;

    const res = await client.query<LeaveBalance>(
      `UPDATE leave_balances
       SET
         opening = $3,
         accrued = $4,
         used = $5,
         adjusted = $6,
         expired = $7,
         encashed = $8,
         pending = $9,
         closing = $10,
         updated_at = now(),
         row_version = row_version + 1
       WHERE company_id = $1 AND id = $2
       RETURNING *`,
      [
        companyId,
        balanceId,
        opening,
        accrued,
        used,
        adjusted,
        expired,
        encashed,
        pending,
        closing,
      ],
    );

    return res.rows[0]!;
  }

  /**
   * Lists leave balances for a company, employee, or period.
   */
  async listBalances(
    companyId: string,
    filters: {
      employeeId?: string | undefined;
      periodKey?: string | undefined;
      leaveTypeId?: string | undefined;
    },
    client: pg.PoolClient,
  ): Promise<LeaveBalance[]> {
    const conditions: string[] = ['company_id = $1'];
    const values: unknown[] = [companyId];
    let pIdx = 2;

    if (filters.employeeId) {
      conditions.push(`employee_id = $${pIdx++}`);
      values.push(filters.employeeId);
    }
    if (filters.periodKey) {
      conditions.push(`period_key = $${pIdx++}`);
      values.push(filters.periodKey);
    }
    if (filters.leaveTypeId) {
      conditions.push(`leave_type_id = $${pIdx++}`);
      values.push(filters.leaveTypeId);
    }

    const query = `
      SELECT *
      FROM leave_balances
      WHERE ${conditions.join(' AND ')}
      ORDER BY period_key DESC, created_at ASC
    `;

    const res = await client.query<LeaveBalance>(query, values);
    return res.rows;
  }
}
