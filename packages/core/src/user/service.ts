import crypto from 'node:crypto';
import { withTenant } from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { UserRepository, type UserSummary } from './repository.js';
import { RbacRepository } from '../rbac/repository.js';
import { invalidateEffectivePermissions } from '../rbac/effective-permissions.js';
import { hashPassword } from '../auth/password.js';
import { revokeAllUserSessions } from '../auth/session.js';
import { AuditService } from '../audit/service.js';
import type {
  ListUsersQuery,
  CreateUserInput,
  UpdateUserInput,
} from './validation.js';

export class UserService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * List users in the tenant.
   * Permission: auth.user.read
   */
  async listUsers(
    ctx: RequestContext,
    query: ListUsersQuery,
  ): Promise<{ users: UserSummary[]; total: number; page: number; limit: number }> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_READ)) {
      throw new ForbiddenError('Permission denied: cannot read users.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new UserRepository(ctx.companyId, client);
      const res = await repo.listUsers(query);
      return {
        ...res,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      };
    });
  }

  /**
   * Get single user by ID.
   * Permission: auth.user.read
   */
  async getUser(ctx: RequestContext, targetUserId: string): Promise<UserSummary> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_READ)) {
      throw new ForbiddenError('Permission denied: cannot read users.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new UserRepository(ctx.companyId, client);
      const user = await repo.findUserById(targetUserId);
      if (!user) {
        throw new NotFoundError('User not found.');
      }
      return user;
    });
  }

  /**
   * Create / invite a user.
   * Permission: auth.user.create
   */
  async createUser(
    ctx: RequestContext,
    input: CreateUserInput,
  ): Promise<{ user: UserSummary; temporaryPassword?: string | undefined }> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_CREATE)) {
      throw new ForbiddenError('Permission denied: cannot create users.');
    }

    const temporaryPassword = input.password ?? crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, 'A') + '1!';
    const passwordHash = await hashPassword(temporaryPassword);

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const userRepo = new UserRepository(ctx.companyId, client);
      const rbacRepo = new RbacRepository(ctx.companyId, client);

      const existing = await userRepo.findUserByEmail(input.email);
      if (existing) {
        throw new ConflictError(`User with email "${input.email}" already exists.`);
      }

      const created = await userRepo.createUser({
        email: input.email,
        passwordHash,
        status: input.status ?? 'active',
        employeeId: input.employeeId,
        createdById: ctx.userId,
      });

      if (input.roleIds && input.roleIds.length > 0) {
        await rbacRepo.assignUserRoles(created.id, input.roleIds, ctx.userId);
      }

      const user = (await userRepo.findUserById(created.id))!;

      // Insert transactional outbox event
      await this.auditService.recordOutboxEvent(
        ctx,
        'user',
        'user.created',
        {
          userId: user.id,
          email: user.email,
          temporaryPassword: input.password ? undefined : temporaryPassword,
        },
        client,
      );

      // Audit log
      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.user.create',
          entity: 'users',
          entityId: user.id,
          after: {
            id: user.id,
            email: user.email,
            roles: user.roles,
            status: user.status,
          },
          clientOverride: client,
        },
      );

      return {
        user,
        temporaryPassword: input.password ? undefined : temporaryPassword,
      };
    });
  }

  /**
   * Update user details.
   * Permission: auth.user.update
   */
  async updateUser(ctx: RequestContext, targetUserId: string, input: UpdateUserInput): Promise<UserSummary> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_UPDATE)) {
      throw new ForbiddenError('Permission denied: cannot update users.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new UserRepository(ctx.companyId, client);
      const before = await repo.findUserById(targetUserId);
      if (!before) {
        throw new NotFoundError('User not found.');
      }

      await repo.updateUser(targetUserId, input, ctx.userId);
      const after = (await repo.findUserById(targetUserId))!;

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.user.update',
          entity: 'users',
          entityId: targetUserId,
          before: {
            id: before.id,
            email: before.email,
            status: before.status,
            employeeId: before.employee_id,
          },
          after: {
            id: after.id,
            email: after.email,
            status: after.status,
            employeeId: after.employee_id,
          },
          clientOverride: client,
        },
      );

      return after;
    });
  }

  /**
   * Deactivate user (status = 'disabled'), revokes all sessions, clears cache.
   * Permission: auth.user.deactivate
   */
  async deactivateUser(ctx: RequestContext, targetUserId: string): Promise<UserSummary> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_DEACTIVATE)) {
      throw new ForbiddenError('Permission denied: cannot deactivate users.');
    }

    if (ctx.userId === targetUserId) {
      throw new ForbiddenError('You cannot deactivate your own account.');
    }

    const updatedUser = await withTenant(
      { companyId: ctx.companyId, userId: ctx.userId },
      async (_tx, client) => {
        const repo = new UserRepository(ctx.companyId, client);
        const before = await repo.findUserById(targetUserId);
        if (!before) {
          throw new NotFoundError('User not found.');
        }

        await repo.updateStatus(targetUserId, 'disabled', ctx.userId);
        const after = (await repo.findUserById(targetUserId))!;

        await this.auditService.recordEvent(
          ctx,
          {
            action: 'auth.user.deactivate',
            entity: 'users',
            entityId: targetUserId,
            before: {
              id: before.id,
              email: before.email,
              status: before.status,
            },
            after: {
              id: after.id,
              email: after.email,
              status: after.status,
            },
            clientOverride: client,
          },
        );

        return after;
      },
    );

    // Revoke all sessions in DB and Redis
    await revokeAllUserSessions(ctx.companyId, targetUserId);

    // Invalidate effective permissions cache immediately
    await invalidateEffectivePermissions(ctx.companyId, targetUserId);

    return updatedUser;
  }

  /**
   * Reactivate user (status = 'active').
   * Permission: auth.user.update
   */
  async reactivateUser(ctx: RequestContext, targetUserId: string): Promise<UserSummary> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_UPDATE)) {
      throw new ForbiddenError('Permission denied: cannot reactivate users.');
    }

    return withTenant({ companyId: ctx.companyId, userId: ctx.userId }, async (_tx, client) => {
      const repo = new UserRepository(ctx.companyId, client);
      const before = await repo.findUserById(targetUserId);
      if (!before) {
        throw new NotFoundError('User not found.');
      }

      await repo.updateStatus(targetUserId, 'active', ctx.userId);
      const after = (await repo.findUserById(targetUserId))!;

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'auth.user.reactivate',
          entity: 'users',
          entityId: targetUserId,
          before: {
            id: before.id,
            email: before.email,
            status: before.status,
          },
          after: {
            id: after.id,
            email: after.email,
            status: after.status,
          },
          clientOverride: client,
        },
      );

      return after;
    });
  }

  /**
   * Reset MFA for a user and revoke sessions so they must re-authenticate.
   * Permission: auth.user.reset_mfa
   */
  async resetMfa(ctx: RequestContext, targetUserId: string): Promise<UserSummary> {
    if (!can(ctx, PERMISSIONS.AUTH_USER_RESET_MFA)) {
      throw new ForbiddenError('Permission denied: cannot reset user MFA.');
    }

    const updatedUser = await withTenant(
      { companyId: ctx.companyId, userId: ctx.userId },
      async (_tx, client) => {
        const repo = new UserRepository(ctx.companyId, client);
        const before = await repo.findUserById(targetUserId);
        if (!before) {
          throw new NotFoundError('User not found.');
        }

        await repo.resetMfa(targetUserId, ctx.userId);
        const after = (await repo.findUserById(targetUserId))!;

        await this.auditService.recordEvent(
          ctx,
          {
            action: 'auth.user.reset_mfa',
            entity: 'users',
            entityId: targetUserId,
            before: {
              id: before.id,
              email: before.email,
              mfaEnabled: before.mfa_enabled,
            },
            after: {
              id: after.id,
              email: after.email,
              mfaEnabled: after.mfa_enabled,
            },
            clientOverride: client,
          },
        );

        return after;
      },
    );

    // Revoke all sessions for security
    await revokeAllUserSessions(ctx.companyId, targetUserId);

    return updatedUser;
  }

  /**
   * Revoke all active sessions for a user.
   * Permission: auth.session.revoke
   */
  async revokeSessions(ctx: RequestContext, targetUserId: string): Promise<{ revoked: number }> {
    if (!can(ctx, PERMISSIONS.AUTH_SESSION_REVOKE)) {
      throw new ForbiddenError('Permission denied: cannot revoke user sessions.');
    }

    const revoked = await revokeAllUserSessions(ctx.companyId, targetUserId);

    await this.auditService.recordEvent(ctx, {
      action: 'auth.session.revoke_all',
      entity: 'users',
      entityId: targetUserId,
      meta: { revokedSessionsCount: revoked },
    });

    return { revoked };
  }
}
