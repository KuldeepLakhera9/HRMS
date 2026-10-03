import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface ChangeRequestRow {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  changes: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  deciderName?: string | null;
  comment: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export class ChangeRequestRepository {
  /**
   * Creates a new profile change request.
   */
  async createChangeRequest(
    companyId: string,
    data: {
      employeeId: string;
      changes: Record<string, unknown>;
      createdBy?: string | null | undefined;
    },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<ChangeRequestRow> {
    const id = generateUuidV7();

    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<ChangeRequestRow>(
        `INSERT INTO change_requests (
           id, company_id, employee_id, changes, status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, 'pending', $5, $5)
         RETURNING
           id, company_id as "companyId", employee_id as "employeeId", changes,
           status, decided_by as "decidedBy", comment, decided_at as "decidedAt",
           created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
        [id, companyId, data.employeeId, JSON.stringify(data.changes), data.createdBy || null],
      );
      return res.rows[0]!;
    };

    if (clientOverride) {
      return execute(clientOverride);
    }

    return withTenant({ companyId }, async (_tx, client) => execute(client), poolOverride);
  }

  /**
   * Finds a change request by ID.
   */
  async findById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<ChangeRequestRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<ChangeRequestRow>(
          `SELECT
             c.id, c.company_id as "companyId", c.employee_id as "employeeId", c.changes,
             c.status, c.decided_by as "decidedBy", c.comment, c.decided_at as "decidedAt",
             c.created_at as "createdAt", c.updated_at as "updatedAt", c.deleted_at as "deletedAt", c.row_version as "rowVersion",
             e.first_name || ' ' || e.last_name as "employeeName", e.emp_code as "employeeCode",
             u.email as "deciderName"
           FROM change_requests c
           JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id
           LEFT JOIN users u ON u.id = c.decided_by AND u.company_id = c.company_id
           WHERE c.company_id = $1 AND c.id = $2 AND c.deleted_at IS NULL
           LIMIT 1`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Lists change requests with optional status and employee filtering.
   */
  async listChangeRequests(
    companyId: string,
    params: {
      status?: string | undefined;
      employeeId?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ items: ChangeRequestRow[]; nextCursor?: string | undefined }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres = ['c.company_id = $1', 'c.deleted_at IS NULL'];
        const values: unknown[] = [companyId];
        let pIdx = 2;

        if (params.status) {
          wheres.push(`c.status = $${pIdx++}`);
          values.push(params.status);
        }

        if (params.employeeId) {
          wheres.push(`c.employee_id = $${pIdx++}`);
          values.push(params.employeeId);
        }

        if (params.cursor) {
          wheres.push(`c.id < $${pIdx++}`);
          values.push(params.cursor);
        }

        const limit = Math.min(params.limit || 50, 100);
        values.push(limit + 1);

        const res = await client.query<ChangeRequestRow>(
          `SELECT
             c.id, c.company_id as "companyId", c.employee_id as "employeeId", c.changes,
             c.status, c.decided_by as "decidedBy", c.comment, c.decided_at as "decidedAt",
             c.created_at as "createdAt", c.updated_at as "updatedAt", c.deleted_at as "deletedAt", c.row_version as "rowVersion",
             e.first_name || ' ' || e.last_name as "employeeName", e.emp_code as "employeeCode",
             u.email as "deciderName"
           FROM change_requests c
           JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id
           LEFT JOIN users u ON u.id = c.decided_by AND u.company_id = c.company_id
           WHERE ${wheres.join(' AND ')}
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT $${pIdx}`,
          values,
        );

        const hasMore = res.rows.length > limit;
        const items = hasMore ? res.rows.slice(0, limit) : res.rows;
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : undefined;

        return { items, nextCursor };
      },
      poolOverride,
    );
  }

  /**
   * Updates status of change request (approved or rejected).
   */
  async updateStatus(
    companyId: string,
    id: string,
    data: {
      status: 'approved' | 'rejected';
      decidedBy: string;
      comment?: string | null | undefined;
    },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<ChangeRequestRow | null> {
    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<ChangeRequestRow>(
        `UPDATE change_requests
         SET status = $1, decided_by = $2, comment = $3, decided_at = now(), updated_at = now()
         WHERE company_id = $4 AND id = $5 AND status = 'pending' AND deleted_at IS NULL
         RETURNING
           id, company_id as "companyId", employee_id as "employeeId", changes,
           status, decided_by as "decidedBy", comment, decided_at as "decidedAt",
           created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
        [data.status, data.decidedBy, data.comment || null, companyId, id],
      );
      return res.rows[0] || null;
    };

    if (clientOverride) {
      return execute(clientOverride);
    }

    return withTenant({ companyId }, async (_tx, client) => execute(client), poolOverride);
  }
}
