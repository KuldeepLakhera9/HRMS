import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  ALL_SYSTEM_ROLES,
  ROLES_REQUIRING_MFA,
  isMfaMandatoryForRole,
  isScopeWiderOrEqual,
} from './index.js';

describe('Permission Catalog and Role Scopes', () => {
  it('ensures all permissions follow module.resource.action convention', () => {
    const pattern = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;
    for (const perm of ALL_PERMISSIONS) {
      expect(perm).toMatch(pattern);
    }
  });

  it('contains essential Phase 1 permissions', () => {
    expect(PERMISSIONS.AUTH_USER_READ).toBe('auth.user.read');
    expect(ALL_PERMISSIONS).toContain('auth.user.read');
    expect(ALL_PERMISSIONS).toContain('org.company.read');
    expect(ALL_PERMISSIONS).toContain('employee.profile.read');
    expect(ALL_PERMISSIONS).toContain('employee.profile.view_sensitive');
    expect(ALL_PERMISSIONS).toContain('audit.log.read');
  });

  it('contains all system roles', () => {
    expect(ALL_SYSTEM_ROLES).toContain('super_admin');
    expect(ALL_SYSTEM_ROLES).toContain('employee');
    expect(ROLES_REQUIRING_MFA.length).toBe(3);
  });

  it('correctly identifies roles requiring mandatory MFA', () => {
    expect(isMfaMandatoryForRole(SYSTEM_ROLES.SUPER_ADMIN)).toBe(true);
    expect(isMfaMandatoryForRole(SYSTEM_ROLES.HR_MANAGER)).toBe(true);
    expect(isMfaMandatoryForRole(SYSTEM_ROLES.ACCOUNTANT)).toBe(true);
    expect(isMfaMandatoryForRole(SYSTEM_ROLES.EMPLOYEE)).toBe(false);
    expect(isMfaMandatoryForRole(SYSTEM_ROLES.MANAGER)).toBe(false);
  });

  it('correctly calculates scope hierarchy', () => {
    expect(isScopeWiderOrEqual('company', 'self')).toBe(true);
    expect(isScopeWiderOrEqual('company', 'department')).toBe(true);
    expect(isScopeWiderOrEqual('team', 'self')).toBe(true);
    expect(isScopeWiderOrEqual('self', 'team')).toBe(false);
    expect(isScopeWiderOrEqual('department', 'company')).toBe(false);
  });
});
