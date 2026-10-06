/**
 * System Roles (locked, is_system = true) per docs/PHASE1_SPEC.md Section 3 and BP section 2.1.
 */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super_admin',
  HR_MANAGER: 'hr_manager',
  ACCOUNTANT: 'accountant',
  FINANCE_HEAD: 'finance_head',
  PAYROLL_AUDITOR: 'payroll_auditor',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
  RECRUITER: 'recruiter',
  AUDITOR: 'auditor',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const ALL_SYSTEM_ROLES = Object.values(SYSTEM_ROLES);

/**
 * Roles that strictly require Multi-Factor Authentication (MFA).
 */
export const ROLES_REQUIRING_MFA: readonly SystemRole[] = [
  SYSTEM_ROLES.SUPER_ADMIN,
  SYSTEM_ROLES.HR_MANAGER,
  SYSTEM_ROLES.ACCOUNTANT,
  SYSTEM_ROLES.FINANCE_HEAD,
  SYSTEM_ROLES.PAYROLL_AUDITOR,
];

export function isMfaMandatoryForRole(role: string): boolean {
  return (ROLES_REQUIRING_MFA as readonly string[]).includes(role);
}
