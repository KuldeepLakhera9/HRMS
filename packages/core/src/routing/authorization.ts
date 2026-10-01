import type { RequestContext } from './context.js';
import { SYSTEM_ROLES } from '@hrms/shared';

export interface AuthorizationTarget {
  companyId?: string;
  departmentId?: string;
  employeeId?: string;
  userId?: string;
}

/**
 * Authorization engine checking if the caller possesses the requested permission
 * within the requested scope and target.
 */
export function can(
  ctx: RequestContext,
  requiredPermission: string,
  target?: AuthorizationTarget,
): boolean {
  // Super admin possesses unconditional company-wide access
  if (ctx.roles?.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    return true;
  }

  // Cross-tenant access is strictly denied
  if (target?.companyId && target.companyId !== ctx.companyId) {
    return false;
  }

  // Check explicit permission grant
  if (ctx.permissions && ctx.permissions.includes(requiredPermission)) {
    return true;
  }

  return false;
}
