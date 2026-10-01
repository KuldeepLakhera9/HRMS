import { SYSTEM_ROLES, type PermissionScope } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';

export interface ResourceTarget {
  companyId?: string;
  departmentId?: string;
  locationId?: string;
  employeeId?: string;
  userId?: string;
  managerId?: string;
  reportingPath?: string[]; // Ancestor IDs for team hierarchy check
}

export interface ExtendedRequestContext extends RequestContext {
  effectivePermissions?: Record<string, PermissionScope>;
  departmentId?: string;
  locationId?: string;
}

/**
 * Authorization engine checking if the caller possesses the requested permission
 * within the requested scope and target resource per docs/PHASE1_SPEC.md Section 3.
 *
 * Scopes: self < team < department < location < company
 * Widest scope wins for a permission key.
 */
export function can(
  ctx: ExtendedRequestContext,
  requiredPermission: string,
  target?: ResourceTarget,
): boolean {
  // 1. Cross-tenant access is strictly denied
  if (target?.companyId && target.companyId !== ctx.companyId) {
    return false;
  }

  // 2. Super admin possesses unconditional company-wide access within their tenant
  if (ctx.roles?.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    return true;
  }

  // 3. Resolve user's granted scope on the permission
  let grantedScope: PermissionScope | undefined;

  if (ctx.effectivePermissions && requiredPermission in ctx.effectivePermissions) {
    grantedScope = ctx.effectivePermissions[requiredPermission];
  } else if (ctx.permissions && ctx.permissions.includes(requiredPermission)) {
    // Fallback if flat array is provided
    grantedScope = 'company';
  }

  if (!grantedScope) {
    return false;
  }

  // If no specific target was provided (e.g. general list or create endpoint), having the permission is sufficient
  if (!target) {
    return true;
  }

  // 4. Scope matching
  switch (grantedScope) {
    case 'company':
      return true;

    case 'location':
      return Boolean(ctx.locationId && target.locationId && ctx.locationId === target.locationId);

    case 'department':
      return Boolean(
        ctx.departmentId && target.departmentId && ctx.departmentId === target.departmentId,
      );

    case 'team':
      // Target is caller themselves
      if (ctx.employeeId && target.employeeId === ctx.employeeId) {
        return true;
      }
      // Target reports directly to caller
      if (ctx.employeeId && target.managerId === ctx.employeeId) {
        return true;
      }
      // Target reportingPath contains caller (indirect subordinate)
      if (ctx.employeeId && target.reportingPath && target.reportingPath.includes(ctx.employeeId)) {
        return true;
      }
      return false;

    case 'self':
      if (target.userId && ctx.userId && target.userId === ctx.userId) {
        return true;
      }
      if (target.employeeId && ctx.employeeId && target.employeeId === ctx.employeeId) {
        return true;
      }
      return false;

    default:
      return false;
  }
}
