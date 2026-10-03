import { withTenant } from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_SCOPES,
  type PermissionScope,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from './can.js';
import {
  RbacRepository,
  type RoleWithCounts,
  type RoleDetail,
} from './repository.js';
import {
  getUserAuthorization,
  invalidateEffectivePermissions,
  type UserAuthorizationData,
} from './effective-permissions.js';
import { AuditService } from '../audit/service.js';
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from './validation.js';

export interface PermissionCatalogItem {
  key: string;
  category: string;
  label: string;
  description: string;
  allowedScopes: PermissionScope[];
}

export class RbacService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * List all roles in the tenant.
   * Permission required: auth.role.read
   */
  async listRoles(ctx: RequestContext): Promise<RoleWithCounts[]> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_READ)) {
      throw new ForbiddenError('Permission denied: cannot read roles.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);
      return repo.listRoles();
    });
  }

  /**
   * Get role details with permissions.
   * Permission required: auth.role.read
   */
  async getRole(ctx: RequestContext, roleId: string): Promise<RoleDetail> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_READ)) {
      throw new ForbiddenError('Permission denied: cannot read roles.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);
      const role = await repo.findRoleById(roleId);
      if (!role) {
        throw new NotFoundError('Role not found.');
      }
      return role;
    });
  }

  /**
   * Create a custom role with permissions.
   * Permission required: auth.role.create
   */
  async createRole(ctx: RequestContext, input: CreateRoleInput): Promise<RoleDetail> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_CREATE)) {
      throw new ForbiddenError('Permission denied: cannot create roles.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);

      const existing = await repo.findRoleByName(input.name);
      if (existing) {
        throw new ConflictError(`A role with name "${input.name}" already exists.`);
      }

      const role = await repo.createRole({
        name: input.name,
        description: input.description,
        requiresMfa: input.requiresMfa,
        permissions: input.permissions ?? [],
        userId: ctx.userId,
      });

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.role.create',
          entity: 'roles',
          entityId: role.id,
          after: {
            id: role.id,
            name: role.name,
            description: role.description,
            requiresMfa: role.requires_mfa,
            permissionsCount: role.permissions.length,
          },
          clientOverride: client,
        },
      );

      return role;
    });
  }

  /**
   * Update a role (permissions, name, description, requiresMfa).
   * Permission required: auth.role.update
   */
  async updateRole(ctx: RequestContext, roleId: string, input: UpdateRoleInput): Promise<RoleDetail> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_UPDATE)) {
      throw new ForbiddenError('Permission denied: cannot update roles.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);
      const existing = await repo.findRoleById(roleId);
      if (!existing) {
        throw new NotFoundError('Role not found.');
      }

      if (existing.is_system && input.name && input.name !== existing.name) {
        throw new ForbiddenError('System role names cannot be renamed.');
      }

      const updated = await repo.updateRole({
        roleId,
        name: input.name,
        description: input.description,
        requiresMfa: input.requiresMfa,
        permissions: input.permissions,
        userId: ctx.userId,
      });

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.role.update',
          entity: 'roles',
          entityId: roleId,
          before: {
            id: existing.id,
            name: existing.name,
            description: existing.description,
            requiresMfa: existing.requires_mfa,
            permissionsCount: existing.permissions.length,
          },
          after: {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            requiresMfa: updated.requires_mfa,
            permissionsCount: updated.permissions.length,
          },
          clientOverride: client,
        },
      );

      return updated;
    });
  }

  /**
   * Delete a custom role.
   * Permission required: auth.role.delete
   */
  async deleteRole(ctx: RequestContext, roleId: string): Promise<void> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_DELETE)) {
      throw new ForbiddenError('Permission denied: cannot delete roles.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);
      const existing = await repo.findRoleById(roleId);
      if (!existing) {
        throw new NotFoundError('Role not found.');
      }

      if (existing.is_system) {
        throw new ForbiddenError('System roles cannot be deleted.');
      }

      const assignedCount = await repo.countAssignedUsers(roleId);
      if (assignedCount > 0) {
        throw new ConflictError(`Cannot delete role: it is assigned to ${assignedCount} user(s).`);
      }

      await repo.deleteRole(roleId, ctx.userId);

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.role.delete',
          entity: 'roles',
          entityId: roleId,
          before: {
            id: existing.id,
            name: existing.name,
            description: existing.description,
          },
          clientOverride: client,
        },
      );
    });
  }

  /**
   * Assign roles to a user.
   * Atomically updates user_roles, bumps perm_version, logs audit, and immediately invalidates Redis cache.
   * Permission required: auth.role.assign
   */
  async assignUserRoles(ctx: RequestContext, targetUserId: string, roleIds: string[]): Promise<void> {
    if (!can(ctx, PERMISSIONS.AUTH_ROLE_ASSIGN)) {
      throw new ForbiddenError('Permission denied: cannot assign roles.');
    }

    await withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new RbacRepository(ctx.companyId, client);
      const beforeRoles = await repo.getUserRoles(targetUserId);

      await repo.assignUserRoles(targetUserId, roleIds, ctx.userId);
      const afterRoles = await repo.getUserRoles(targetUserId);

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.role.assign',
          entity: 'users',
          entityId: targetUserId,
          before: { roles: beforeRoles },
          after: { roles: afterRoles },
          clientOverride: client,
        },
      );
    });

    // Invalidate Redis effective permissions cache immediately
    await invalidateEffectivePermissions(ctx.companyId, targetUserId);
  }

  /**
   * Get user effective permissions.
   * Permission required: auth.role.read, auth.user.read, or own self
   */
  async getUserEffectivePermissions(
    ctx: RequestContext,
    targetUserId: string,
  ): Promise<UserAuthorizationData & { assignedRoles: { id: string; name: string; is_system: boolean }[] }> {
    const isSelf = ctx.userId === targetUserId;
    if (!isSelf && !can(ctx, PERMISSIONS.AUTH_ROLE_READ) && !can(ctx, PERMISSIONS.AUTH_USER_READ)) {
      throw new ForbiddenError('Permission denied: cannot view effective permissions.');
    }

    const authData = await getUserAuthorization(ctx.companyId, targetUserId);

    const assignedRoles = await withTenant(
      { companyId: ctx.companyId, userId: ctx.userId },
      async (_tx, client) => {
        const repo = new RbacRepository(ctx.companyId, client);
        return repo.getUserRoles(targetUserId);
      },
    );

    return {
      ...authData,
      assignedRoles,
    };
  }

  /**
   * Get full catalog of permissions grouped by category.
   */
  getPermissionCatalog(): PermissionCatalogItem[] {
    const catalog: PermissionCatalogItem[] = [];

    for (const key of ALL_PERMISSIONS) {
      const parts = key.split('.');
      const category = parts[0] ?? 'general';
      const resource = parts[1] ?? '';
      const action = parts[2] ?? '';

      const label = `${resource} ${action}`
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      catalog.push({
        key,
        category: category.toUpperCase(),
        label,
        description: `Allows to ${action.replace('_', ' ')} ${resource} in ${category}`,
        allowedScopes: [...PERMISSION_SCOPES],
      });
    }

    return catalog;
  }
}
