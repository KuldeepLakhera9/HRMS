import { generateUuidV7 } from '@hrms/db';
import { TenantRepository } from '../rbac/repository.js';
import type { ListUsersQuery } from './validation.js';

export interface UserSummary {
  id: string;
  company_id: string;
  email: string;
  status: 'invited' | 'active' | 'locked' | 'disabled';
  mfa_enabled: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  perm_version: number;
  employee_id: string | null;
  created_at: Date;
  updated_at: Date;
  roles: { id: string; name: string }[];
  employee: {
    id: string;
    emp_code: string;
    first_name: string;
    last_name: string;
  } | null;
}

export class UserRepository extends TenantRepository {
  /**
   * List users with pagination, filters, role aggregation, and employee profile link.
   */
  async listUsers(query: ListUsersQuery): Promise<{ users: UserSummary[]; total: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ['u.company_id = $1', 'u.deleted_at IS NULL'];
    const params: unknown[] = [this.companyId];

    if (query.status) {
      params.push(query.status);
      whereClauses.push(`u.status = $${params.length}`);
    }

    if (query.roleId) {
      params.push(query.roleId);
      whereClauses.push(
        `EXISTS (
          SELECT 1 FROM user_roles ur2
          WHERE ur2.company_id = u.company_id AND ur2.user_id = u.id AND ur2.role_id = $${params.length} AND ur2.deleted_at IS NULL
        )`,
      );
    }

    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`);
      const searchParamIndex = params.length;
      whereClauses.push(
        `(
          u.email ILIKE $${searchParamIndex}
          OR e.emp_code ILIKE $${searchParamIndex}
          OR (e.first_name || ' ' || e.last_name) ILIKE $${searchParamIndex}
        )`,
      );
    }

    const whereSql = whereClauses.join(' AND ');

    // Count total
    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*)::text as count
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id AND u.company_id = e.company_id AND e.deleted_at IS NULL
       WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    // Fetch paginated
    const dataParams = [...params, limit, offset];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const sql = `
      SELECT
        u.id, u.company_id, u.email, u.status, u.mfa_enabled, u.failed_attempts,
        u.locked_until, u.last_login_at, u.perm_version, u.employee_id,
        u.created_at, u.updated_at,
        COALESCE(
          json_agg(
            json_build_object('id', r.id, 'name', r.name)
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) as roles,
        CASE
          WHEN e.id IS NOT NULL THEN
            json_build_object(
              'id', e.id,
              'emp_code', e.emp_code,
              'first_name', e.first_name,
              'last_name', e.last_name
            )
          ELSE NULL
        END as employee
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id AND u.company_id = e.company_id AND e.deleted_at IS NULL
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND u.company_id = ur.company_id AND ur.deleted_at IS NULL
      LEFT JOIN roles r ON ur.role_id = r.id AND ur.company_id = r.company_id AND r.deleted_at IS NULL
      WHERE ${whereSql}
      GROUP BY u.id, e.id
      ORDER BY u.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const res = await this.db.query<UserSummary>(sql, dataParams);
    return { users: res.rows, total };
  }

  /**
   * Find user by ID.
   */
  async findUserById(userId: string): Promise<UserSummary | null> {
    const sql = `
      SELECT
        u.id, u.company_id, u.email, u.status, u.mfa_enabled, u.failed_attempts,
        u.locked_until, u.last_login_at, u.perm_version, u.employee_id,
        u.created_at, u.updated_at,
        COALESCE(
          json_agg(
            json_build_object('id', r.id, 'name', r.name)
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) as roles,
        CASE
          WHEN e.id IS NOT NULL THEN
            json_build_object(
              'id', e.id,
              'emp_code', e.emp_code,
              'first_name', e.first_name,
              'last_name', e.last_name
            )
          ELSE NULL
        END as employee
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id AND u.company_id = e.company_id AND e.deleted_at IS NULL
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND u.company_id = ur.company_id AND ur.deleted_at IS NULL
      LEFT JOIN roles r ON ur.role_id = r.id AND ur.company_id = r.company_id AND r.deleted_at IS NULL
      WHERE u.company_id = $1 AND u.id = $2 AND u.deleted_at IS NULL
      GROUP BY u.id, e.id
    `;
    const res = await this.db.query<UserSummary>(sql, [this.companyId, userId]);
    return res.rows[0] ?? null;
  }

  /**
   * Find user by email in tenant.
   */
  async findUserByEmail(email: string): Promise<UserSummary | null> {
    const res = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
      [this.companyId, email.trim()],
    );
    if (!res.rows[0]) return null;
    return this.findUserById(res.rows[0].id);
  }

  /**
   * Create new user record.
   */
  async createUser(params: {
    email: string;
    passwordHash: string;
    status: string;
    employeeId?: string | null | undefined;
    createdById?: string | undefined;
  }): Promise<{ id: string }> {
    const id = generateUuidV7();
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO users (
        id, company_id, email, password_hash, status, mfa_enabled,
        perm_version, employee_id, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, false, 1, $6, $7, $7, now(), now()
      ) RETURNING id`,
      [
        id,
        this.companyId,
        params.email.toLowerCase().trim(),
        params.passwordHash,
        params.status,
        params.employeeId ?? null,
        params.createdById ?? null,
      ],
    );
    return res.rows[0]!;
  }

  /**
   * Update user details.
   */
  async updateUser(userId: string, data: { employeeId?: string | null | undefined; status?: string | undefined }, updatedBy?: string): Promise<void> {
    const updates: string[] = ['updated_at = now()'];
    const params: unknown[] = [this.companyId, userId];

    if (data.employeeId !== undefined) {
      params.push(data.employeeId);
      updates.push(`employee_id = $${params.length}`);
    }

    if (data.status !== undefined) {
      params.push(data.status);
      updates.push(`status = $${params.length}`);
    }

    if (updatedBy) {
      params.push(updatedBy);
      updates.push(`updated_by = $${params.length}`);
    }

    await this.db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      params,
    );
  }

  /**
   * Update user status (active / disabled / locked).
   */
  async updateStatus(userId: string, status: string, updatedBy?: string): Promise<void> {
    await this.db.query(
      `UPDATE users
       SET status = $1, updated_by = $2, updated_at = now()
       WHERE company_id = $3 AND id = $4 AND deleted_at IS NULL`,
      [status, updatedBy ?? null, this.companyId, userId],
    );
  }

  /**
   * Reset MFA for user.
   */
  async resetMfa(userId: string, updatedBy?: string): Promise<void> {
    await this.db.query(
      `UPDATE users
       SET mfa_enabled = false, mfa_secret_enc = null, updated_by = $1, updated_at = now()
       WHERE company_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [updatedBy ?? null, this.companyId, userId],
    );
  }
}
