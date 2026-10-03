import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, seedDatabase, withTenant } from '@hrms/db';
import {
  RbacService,
  UserService,
  type RequestContext,
  getUserAuthorization,
  getEffectivePermissionsCacheKey,
  createSession,
  getSessionByToken,
} from '@hrms/core';
import { ALL_PERMISSIONS, PERMISSIONS, ForbiddenError, ConflictError } from '@hrms/shared';
import { getRedisClient } from '@hrms/core';

describe('Sprint 1.2 P1-RBAC-04 & P1-RBAC-05: Permission Matrix & User Administration Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let rbacService: RbacService;
  let userService: UserService;

  beforeAll(async () => {
    db = await setupTestDatabase();
    rbacService = new RbacService();
    userService = new UserService();

    // Ensure database is seeded with 7 system roles & super admin
    const seedResult = await seedDatabase(db.ownerPool);
    companyId = seedResult.companyId;

    // Fetch super admin user id
    await withTenant({ companyId, userId: generateUuidV7() }, async (_tx, client) => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE company_id = $1 AND email = 'admin@orghub.internal'`,
        [companyId],
      );
      adminUserId = res.rows[0]!.id;
    }, db.appPool);

    adminCtx = {
      companyId,
      userId: adminUserId,
      roles: ['super_admin'],
      permissions: [...ALL_PERMISSIONS],
      requestId: 'req-test-admin',
      isAuthenticated: true,
    };
  });

  afterAll(async () => {
    try {
      await withTenant({ companyId, userId: adminUserId }, async (_tx, client) => {
        await client.query("DELETE FROM roles WHERE company_id = $1 AND is_system = false", [companyId]);
        await client.query("DELETE FROM users WHERE company_id = $1 AND email != 'admin@orghub.internal'", [companyId]);
      }, db.appPool);
    } catch {
      // Non-fatal cleanup
    }
    await db.close();
  });

  it('provisions and protects all 7 system roles against deletion and renaming', async () => {
    const roles = await rbacService.listRoles(adminCtx);
    expect(roles.length).toBeGreaterThanOrEqual(7);

    const systemRoleNames = roles.filter(r => r.is_system).map(r => r.name);
    expect(systemRoleNames).toContain('super_admin');
    expect(systemRoleNames).toContain('admin');
    expect(systemRoleNames).toContain('hr_manager');
    expect(systemRoleNames).toContain('payroll_manager');
    expect(systemRoleNames).toContain('employee');
    expect(systemRoleNames).toContain('contractor');
    expect(systemRoleNames).toContain('auditor');

    const superAdminRole = roles.find(r => r.name === 'super_admin')!;
    expect(superAdminRole.is_system).toBe(true);

    // 1. Deletion of system role must throw ForbiddenError
    await expect(rbacService.deleteRole(adminCtx, superAdminRole.id)).rejects.toThrow(
      ForbiddenError,
    );

    // 2. Renaming of system role must throw ForbiddenError
    await expect(
      rbacService.updateRole(adminCtx, superAdminRole.id, { name: 'renamed_admin' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('manages custom roles with permission matrix scopes', async () => {
    // 1. Get Permission Catalog
    const catalog = rbacService.getPermissionCatalog();
    expect(catalog.length).toBe(ALL_PERMISSIONS.length);
    expect(catalog.some(c => c.key === PERMISSIONS.EMPLOYEE_PROFILE_READ)).toBe(true);

    // 2. Create custom role
    const customRole = await rbacService.createRole(adminCtx, {
      name: `custom_lead_${Date.now()}`,
      description: 'Regional Lead with team and location scopes',
      requiresMfa: true,
      permissions: [
        { permissionKey: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'location' },
        { permissionKey: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' },
      ],
    });

    expect(customRole.id).toBeDefined();
    expect(customRole.is_system).toBe(false);
    expect(customRole.requires_mfa).toBe(true);
    expect(customRole.permissions).toHaveLength(2);

    // 3. Update custom role permissions
    const updated = await rbacService.updateRole(adminCtx, customRole.id, {
      description: 'Updated Regional Lead description',
      permissions: [
        { permissionKey: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'company' },
        { permissionKey: PERMISSIONS.EMPLOYEE_PROFILE_UPDATE, scope: 'team' },
        { permissionKey: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' },
      ],
    });

    expect(updated.description).toBe('Updated Regional Lead description');
    expect(updated.permissions).toHaveLength(3);
    const empRead = updated.permissions.find(p => p.permission_key === PERMISSIONS.EMPLOYEE_PROFILE_READ);
    expect(empRead?.scope).toBe('company');
  });

  it('manages user administration lifecycle, role assignments, and immediate Redis cache invalidation', async () => {
    const redis = getRedisClient();
    const testEmail = `operator_${Date.now()}@orghub.internal`;

    // 1. Find roles to assign
    const roles = await rbacService.listRoles(adminCtx);
    const employeeRole = roles.find(r => r.name === 'employee')!;
    const hrRole = roles.find(r => r.name === 'hr_manager')!;

    // 2. Create user with 'employee' role
    const createRes = await userService.createUser(adminCtx, {
      email: testEmail,
      status: 'active',
      roleIds: [employeeRole.id],
    });

    expect(createRes.user.id).toBeDefined();
    expect(createRes.user.email).toBe(testEmail);
    expect(createRes.user.roles).toHaveLength(1);
    expect(createRes.user.roles[0]?.name).toBe('employee');
    const targetUserId = createRes.user.id;

    // 3. Compute authorization and verify Redis caching
    const auth1 = await getUserAuthorization(companyId, targetUserId, db.appPool);
    expect(auth1.roles).toEqual(['employee']);
    expect(auth1.permissions).toContain(PERMISSIONS.EMPLOYEE_PROFILE_READ);
    expect(auth1.effectivePermissions[PERMISSIONS.EMPLOYEE_PROFILE_READ]).toBe('self');

    const cacheKey = getEffectivePermissionsCacheKey(companyId, targetUserId);
    const cachedBefore = await redis.get(cacheKey);
    expect(cachedBefore).not.toBeNull();

    // 4. Assign hr_manager role -> Must invalidate Redis cache immediately!
    await rbacService.assignUserRoles(adminCtx, targetUserId, [hrRole.id]);

    const cachedAfter = await redis.get(cacheKey);
    expect(cachedAfter).toBeNull(); // Cache was immediately invalidated!

    // 5. Re-fetching authorization reflects the updated role immediately
    const auth2 = await getUserAuthorization(companyId, targetUserId, db.appPool);
    expect(auth2.roles).toEqual(['hr_manager']);
    expect(auth2.effectivePermissions[PERMISSIONS.EMPLOYEE_PROFILE_READ]).toBe('company');

    // 6. Test effective permissions endpoint view
    const effectiveView = await rbacService.getUserEffectivePermissions(adminCtx, targetUserId);
    expect(effectiveView.roles).toContain('hr_manager');
    expect(effectiveView.assignedRoles[0]?.name).toBe('hr_manager');
  });

  it('enforces session revocation on user deactivation and MFA reset', async () => {
    const userEmail = `session_user_${Date.now()}@orghub.internal`;
    const createRes = await userService.createUser(adminCtx, {
      email: userEmail,
      status: 'active',
      roleIds: [],
    });
    const targetUserId = createRes.user.id;

    // 1. Create active session for the user
    const session = await createSession({
      companyId,
      userId: targetUserId,
      ip: '10.0.0.5',
      deviceLabel: 'Test Device',
      poolOverride: db.appPool,
    });

    const activeSession = await getSessionByToken(session.rawToken, db.appPool);
    expect(activeSession).not.toBeNull();

    // 2. Deactivate user -> sessions must be terminated
    const deactivated = await userService.deactivateUser(adminCtx, targetUserId);
    expect(deactivated.status).toBe('disabled');

    const sessionAfterDeactivate = await getSessionByToken(session.rawToken, db.appPool);
    expect(sessionAfterDeactivate).toBeNull();

    // 3. Reactivate user
    const reactivated = await userService.reactivateUser(adminCtx, targetUserId);
    expect(reactivated.status).toBe('active');

    // 4. Create new session and test MFA reset revocation
    const session2 = await createSession({
      companyId,
      userId: targetUserId,
      ip: '10.0.0.6',
      poolOverride: db.appPool,
    });
    expect(await getSessionByToken(session2.rawToken, db.appPool)).not.toBeNull();

    await userService.resetMfa(adminCtx, targetUserId);
    expect(await getSessionByToken(session2.rawToken, db.appPool)).toBeNull();
  });

  it('guards custom roles against deletion when assigned to users', async () => {
    // 1. Create custom role
    const role = await rbacService.createRole(adminCtx, {
      name: `assigned_role_${Date.now()}`,
      description: 'Temporary role',
      permissions: [{ permissionKey: PERMISSIONS.AUDIT_LOG_READ, scope: 'company' }],
    });

    // 2. Create user with this role
    const userRes = await userService.createUser(adminCtx, {
      email: `temp_user_${Date.now()}@orghub.internal`,
      status: 'active',
      roleIds: [role.id],
    });

    // 3. Attempting to delete role must throw ConflictError
    await expect(rbacService.deleteRole(adminCtx, role.id)).rejects.toThrow(ConflictError);

    // 4. Unassign role from user
    await rbacService.assignUserRoles(adminCtx, userRes.user.id, []);

    // 5. Deletion now succeeds
    await rbacService.deleteRole(adminCtx, role.id);

    // 6. Verify role is deleted
    await expect(rbacService.getRole(adminCtx, role.id)).rejects.toThrow();
  });
});
