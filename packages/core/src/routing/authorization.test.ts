import { describe, it, expect } from 'vitest';
import { can } from './authorization.js';
import { SYSTEM_ROLES, PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from './context.js';

describe('can() Authorization Engine', () => {
  const baseContext: RequestContext = {
    companyId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    requestId: 'req-1',
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.EMPLOYEE],
    permissions: [PERMISSIONS.EMPLOYEE_PROFILE_READ],
  };

  it('allows access when user possesses explicit permission', () => {
    expect(can(baseContext, PERMISSIONS.EMPLOYEE_PROFILE_READ)).toBe(true);
  });

  it('denies access when user does not possess required permission', () => {
    expect(can(baseContext, PERMISSIONS.ORG_COMPANY_UPDATE)).toBe(false);
  });

  it('super admin bypasses permission checks for same tenant', () => {
    const adminCtx: RequestContext = {
      ...baseContext,
      roles: [SYSTEM_ROLES.SUPER_ADMIN],
      permissions: [],
    };
    expect(can(adminCtx, PERMISSIONS.ORG_COMPANY_UPDATE)).toBe(true);
  });

  it('strictly denies cross-tenant target even for matching permission', () => {
    expect(
      can(baseContext, PERMISSIONS.EMPLOYEE_PROFILE_READ, {
        companyId: '99999999-9999-9999-9999-999999999999', // Different company
      }),
    ).toBe(false);
  });
});
