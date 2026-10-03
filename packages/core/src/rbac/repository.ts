import type pg from 'pg';
import { getAppPool, generateUuidV7 } from '@hrms/db';
import type { PermissionScope } from '@hrms/shared';

export abstract class TenantRepository {
  protected readonly companyId: string;
  protected readonly client: pg.PoolClient | pg.Pool | undefined;

  constructor(companyId: string, client?: pg.PoolClient | pg.Pool | undefined) {
    if (!companyId) {
      throw new Error('[TenantRepository] companyId is mandatory for all repository instances.');
    }
    this.companyId = companyId;
    this.client = client;
  }

  protected get db(): pg.PoolClient | pg.Pool {
    return this.client ?? getAppPool();
  }

  public getCompanyId(): string {
    return this.companyId;
  }
}

export interface RoleWithCounts {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
  version: number;
  user_count: number;
  permission_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface RoleDetail {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  permissions: {
    permission_key: string;
    scope: PermissionScope;
  }[];
}

export class RbacRepository extends TenantRepository {
  /**
   * List all roles for the tenant with user count and permission count.
   */
  async listRoles(): Promise<RoleWithCounts[]> {
    const res = await this.db.query<RoleWithCounts>(
      `SELECT r.id, r.company_id, r.name, r.description, r.is_system, r.requires_mfa, r.version,
              r.created_at, r.updated_at,
              COALESCE(u.user_count, 0)::int as user_count,
              COALESCE(p.permission_count, 0)::int as permission_count
       FROM roles r
       LEFT JOIN (
         SELECT role_id, count(*)::int as user_count
         FROM user_roles
         WHERE company_id = $1 AND deleted_at IS NULL
         GROUP BY role_id
       ) u ON r.id = u.role_id
       LEFT JOIN (
         SELECT role_id, count(*)::int as permission_count
         FROM role_permissions
         WHERE company_id = $1 AND deleted_at IS NULL
         GROUP BY role_id
       ) p ON r.id = p.role_id
       WHERE r.company_id = $1 AND r.deleted_at IS NULL
       ORDER BY r.is_system DESC, r.name ASC`,
      [this.companyId],
    );
    return res.rows;
  }

  /**
   * Find role by ID with its configured permissions.
   */
  async findRoleById(roleId: string): Promise<RoleDetail | null> {
    const roleRes = await this.db.query<{
      id: string;
      company_id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      requires_mfa: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, company_id, name, description, is_system, requires_mfa, version, created_at, updated_at
       FROM roles
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.companyId, roleId],
    );

    const role = roleRes.rows[0];
    if (!role) return null;

    const permsRes = await this.db.query<{
      permission_key: string;
      scope: PermissionScope;
    }>(
      `SELECT permission_key, scope
       FROM role_permissions
       WHERE company_id = $1 AND role_id = $2 AND deleted_at IS NULL
       ORDER BY permission_key ASC`,
      [this.companyId, roleId],
    );

    return {
      ...role,
      permissions: permsRes.rows,
    };
  }

  /**
   * Find role by unique name.
   */
  async findRoleByName(name: string): Promise<RoleDetail | null> {
    const roleRes = await this.db.query<{ id: string }>(
      `SELECT id FROM roles WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [this.companyId, name],
    );
    if (!roleRes.rows[0]) return null;
    return this.findRoleById(roleRes.rows[0].id);
  }

  /**
   * Create a new custom role with its permissions.
   */
  async createRole(params: {
    name: string;
    description?: string | undefined;
    requiresMfa?: boolean | undefined;
    permissions: { permissionKey: string; scope: PermissionScope }[];
    userId?: string | undefined;
  }): Promise<RoleDetail> {
    const roleId = generateUuidV7();
    const roleRes = await this.db.query<{
      id: string;
      company_id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      requires_mfa: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO roles (id, company_id, name, description, is_system, requires_mfa, version, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, $5, 1, $6, $6, now(), now())
       RETURNING id, company_id, name, description, is_system, requires_mfa, version, created_at, updated_at`,
      [roleId, this.companyId, params.name, params.description ?? null, params.requiresMfa ?? false, params.userId ?? null],
    );

    const role = roleRes.rows[0]!;

    if (params.permissions.length > 0) {
      for (const p of params.permissions) {
        await this.db.query(
          `INSERT INTO role_permissions (id, company_id, role_id, permission_key, scope, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, now(), now())`,
          [generateUuidV7(), this.companyId, roleId, p.permissionKey, p.scope, params.userId ?? null],
        );
      }
    }

    return {
      ...role,
      permissions: params.permissions.map(p => ({
        permission_key: p.permissionKey,
        scope: p.scope,
      })),
    };
  }

  /**
   * Update role metadata and permissions.
   */
  async updateRole(params: {
    roleId: string;
    name?: string | undefined;
    description?: string | null | undefined;
    requiresMfa?: boolean | undefined;
    permissions?: { permissionKey: string; scope: PermissionScope }[] | undefined;
    userId?: string | undefined;
  }): Promise<RoleDetail> {
    const current = await this.findRoleById(params.roleId);
    if (!current) {
      throw new Error('Role not found');
    }

    // System roles: cannot change name
    const finalName = current.is_system ? current.name : (params.name ?? current.name);
    const finalDesc = params.description !== undefined ? params.description : current.description;
    const finalRequiresMfa = params.requiresMfa !== undefined ? params.requiresMfa : current.requires_mfa;

    await this.db.query(
      `UPDATE roles
       SET name = $1, description = $2, requires_mfa = $3, version = version + 1, updated_by = $4, updated_at = now()
       WHERE company_id = $5 AND id = $6 AND deleted_at IS NULL`,
      [finalName, finalDesc, finalRequiresMfa, params.userId ?? null, this.companyId, params.roleId],
    );

    if (params.permissions !== undefined) {
      // Delete existing permissions and re-insert
      await this.db.query(
        `DELETE FROM role_permissions WHERE company_id = $1 AND role_id = $2`,
        [this.companyId, params.roleId],
      );

      for (const p of params.permissions) {
        await this.db.query(
          `INSERT INTO role_permissions (id, company_id, role_id, permission_key, scope, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, now(), now())`,
          [generateUuidV7(), this.companyId, params.roleId, p.permissionKey, p.scope, params.userId ?? null],
        );
      }
    }

    return (await this.findRoleById(params.roleId))!;
  }

  /**
   * Delete custom role.
   */
  async deleteRole(roleId: string, userId?: string): Promise<void> {
    // Delete role_permissions first, then soft-delete role
    await this.db.query(
      `DELETE FROM role_permissions WHERE company_id = $1 AND role_id = $2`,
      [this.companyId, roleId],
    );

    await this.db.query(
      `UPDATE roles
       SET deleted_at = now(), updated_by = $1, updated_at = now()
       WHERE company_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [userId ?? null, this.companyId, roleId],
    );
  }

  /**
   * Check if role has assigned users.
   */
  async countAssignedUsers(roleId: string): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*)::text as count
       FROM user_roles
       WHERE company_id = $1 AND role_id = $2 AND deleted_at IS NULL`,
      [this.companyId, roleId],
    );
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }

  /**
   * Get roles assigned to a user.
   */
  async getUserRoles(userId: string): Promise<{ id: string; name: string; is_system: boolean }[]> {
    const res = await this.db.query<{ id: string; name: string; is_system: boolean }>(
      `SELECT r.id, r.name, r.is_system
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id AND ur.company_id = r.company_id
       WHERE ur.company_id = $1 AND ur.user_id = $2 AND ur.deleted_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.name ASC`,
      [this.companyId, userId],
    );
    return res.rows;
  }

  /**
   * Replace user roles atomically and bump user perm_version.
   */
  async assignUserRoles(userId: string, roleIds: string[], updatedBy?: string): Promise<void> {
    // 1. Delete existing user_roles
    await this.db.query(
      `DELETE FROM user_roles WHERE company_id = $1 AND user_id = $2`,
      [this.companyId, userId],
    );

    // 2. Insert new user_roles
    for (const roleId of roleIds) {
      await this.db.query(
        `INSERT INTO user_roles (id, company_id, user_id, role_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, now(), now())`,
        [generateUuidV7(), this.companyId, userId, roleId, updatedBy ?? null],
      );
    }

    // 3. Increment perm_version on user
    await this.db.query(
      `UPDATE users SET perm_version = perm_version + 1, updated_at = now()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.companyId, userId],
    );
  }
}
