import { describe, it, expect } from 'vitest';
import { can, type ExtendedRequestContext } from './can.js';
import { SYSTEM_ROLES, PERMISSIONS } from '@hrms/shared';

function mockCtx(
  overrides: Partial<ExtendedRequestContext> & { companyId: string },
): ExtendedRequestContext {
  return {
    requestId: 'req-test-123',
    isAuthenticated: true,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe('RBAC Authorization Engine (can()) Unit Tests', () => {
  const companyA = '11111111-1111-1111-1111-111111111111';
  const companyB = '22222222-2222-2222-2222-222222222222';
  const user1 = 'uuuuuuuu-1111-1111-1111-111111111111';
  const employee1 = 'eeeeeeee-1111-1111-1111-111111111111';

  it('strictly rejects any cross-tenant request regardless of roles or permissions', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      roles: [SYSTEM_ROLES.SUPER_ADMIN],
      permissions: [PERMISSIONS.ORG_COMPANY_READ],
    });

    const target = { companyId: companyB };
    expect(can(ctx, PERMISSIONS.ORG_COMPANY_READ, target)).toBe(false);
  });

  it('super admin possesses unconditional company-wide access within tenant', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      roles: [SYSTEM_ROLES.SUPER_ADMIN],
    });

    expect(can(ctx, PERMISSIONS.ORG_DEPARTMENT_MANAGE, { companyId: companyA })).toBe(true);
  });

  it('allows access with company scope anywhere in the tenant', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      roles: [SYSTEM_ROLES.HR_MANAGER],
      effectivePermissions: {
        [PERMISSIONS.EMPLOYEE_PROFILE_READ]: 'company',
      },
    });

    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        departmentId: 'dept-any',
      }),
    ).toBe(true);
  });

  it('enforces department scope matching', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      roles: [SYSTEM_ROLES.MANAGER],
      departmentId: 'dept-sales',
      effectivePermissions: {
        [PERMISSIONS.EMPLOYEE_PROFILE_READ]: 'department',
      },
    });

    // Same department -> allowed
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        departmentId: 'dept-sales',
      }),
    ).toBe(true);

    // Different department -> denied
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        departmentId: 'dept-engineering',
      }),
    ).toBe(false);
  });

  it('enforces location scope matching', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      roles: [SYSTEM_ROLES.HR_MANAGER],
      locationId: 'loc-mumbai',
      effectivePermissions: {
        [PERMISSIONS.EMPLOYEE_PROFILE_READ]: 'location',
      },
    });

    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        locationId: 'loc-mumbai',
      }),
    ).toBe(true);

    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        locationId: 'loc-bangalore',
      }),
    ).toBe(false);
  });

  it('enforces team scope (direct subordinate, indirect subordinate via reportingPath, self)', () => {
    const managerId = employee1;
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      employeeId: managerId,
      roles: [SYSTEM_ROLES.MANAGER],
      effectivePermissions: {
        [PERMISSIONS.EMPLOYEE_PROFILE_READ]: 'team',
      },
    });

    // 1. Direct report
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        managerId: managerId,
        employeeId: 'emp-direct',
      }),
    ).toBe(true);

    // 2. Indirect report with reportingPath containing managerId
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        employeeId: 'emp-indirect',
        reportingPath: ['ceo-id', managerId, 'lead-id'],
      }),
    ).toBe(true);

    // 3. Self
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        employeeId: managerId,
      }),
    ).toBe(true);

    // 4. Peer or outside reporting line -> denied
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        employeeId: 'emp-other',
        managerId: 'other-manager-id',
        reportingPath: ['ceo-id', 'other-manager-id'],
      }),
    ).toBe(false);
  });

  it('enforces self scope strictly to the caller', () => {
    const ctx = mockCtx({
      companyId: companyA,
      userId: user1,
      employeeId: employee1,
      roles: [SYSTEM_ROLES.EMPLOYEE],
      effectivePermissions: {
        [PERMISSIONS.EMPLOYEE_PROFILE_READ]: 'self',
      },
    });

    // Caller self -> allowed
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        userId: user1,
      }),
    ).toBe(true);

    // Other user -> denied
    expect(
      can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: companyA,
        userId: 'other-user-id',
      }),
    ).toBe(false);
  });
});
