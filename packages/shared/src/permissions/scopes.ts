export const PERMISSION_SCOPES = [
  'self',
  'team',
  'department',
  'location',
  'company',
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const SCOPE_HIERARCHY: Record<PermissionScope, number> = {
  self: 1,
  team: 2,
  department: 3,
  location: 4,
  company: 5,
};

/**
 * Returns whether scopeA is wider than or equal to scopeB.
 */
export function isScopeWiderOrEqual(a: PermissionScope, b: PermissionScope): boolean {
  return SCOPE_HIERARCHY[a] >= SCOPE_HIERARCHY[b];
}
