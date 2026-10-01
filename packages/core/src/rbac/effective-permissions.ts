import type pg from 'pg';
import { withTenant } from '@hrms/db';
import { SCOPE_HIERARCHY, type PermissionScope } from '@hrms/shared';
import { getRedisClient } from '../redis/client.js';

const CACHE_TTL_SECONDS = 300; // 5 minutes

export interface UserAuthorizationData {
  roles: string[];
  permissions: string[];
  effectivePermissions: Record<string, PermissionScope>;
}

export function getEffectivePermissionsCacheKey(companyId: string, userId: string): string {
  return `eff:${companyId}:${userId}`;
}

/**
 * Computes and returns user's roles, flat permissions list, and scoped permission mapping.
 * Runs inside withTenant to satisfy RLS and caches in Redis for sub-millisecond route checks.
 */
export async function getUserAuthorization(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<UserAuthorizationData> {
  const redis = getRedisClient();
  const cacheKey = getEffectivePermissionsCacheKey(companyId, userId);

  // 1. Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as UserAuthorizationData;
    }
  } catch {
    // Redis unavailable, fallback to DB query
  }

  // 2. Query PostgreSQL within tenant context
  const authData = await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      const res = await client.query<{
        role_name: string;
        permission_key: string | null;
        scope: PermissionScope | null;
      }>(
        `SELECT r.name as role_name, rp.permission_key, rp.scope
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id AND ur.company_id = r.company_id
         LEFT JOIN role_permissions rp ON r.id = rp.role_id AND r.company_id = rp.company_id AND rp.deleted_at IS NULL
         WHERE ur.company_id = $1 AND ur.user_id = $2
           AND ur.deleted_at IS NULL AND r.deleted_at IS NULL`,
        [companyId, userId],
      );

      const rolesSet = new Set<string>();
      const effectivePermissions: Record<string, PermissionScope> = {};

      for (const row of res.rows) {
        if (row.role_name) {
          rolesSet.add(row.role_name);
        }
        if (row.permission_key && row.scope) {
          const existing = effectivePermissions[row.permission_key];
          if (!existing || SCOPE_HIERARCHY[row.scope] > SCOPE_HIERARCHY[existing]) {
            effectivePermissions[row.permission_key] = row.scope;
          }
        }
      }

      return {
        roles: Array.from(rolesSet),
        permissions: Object.keys(effectivePermissions),
        effectivePermissions,
      };
    },
    poolOverride,
  );

  // 3. Cache in Redis
  try {
    await redis.set(cacheKey, JSON.stringify(authData), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal if cache write fails
  }

  return authData;
}

/**
 * Backward compatible helper returning just effective permissions mapping.
 */
export async function getEffectivePermissions(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<Record<string, PermissionScope>> {
  const auth = await getUserAuthorization(companyId, userId, poolOverride);
  return auth.effectivePermissions;
}

/**
 * Invalidates the cached effective permissions for a user in Redis.
 * Called immediately whenever a user's roles, role permissions, or assignments change.
 */
export async function invalidateEffectivePermissions(
  companyId: string,
  userId: string,
): Promise<void> {
  const redis = getRedisClient();
  const cacheKey = getEffectivePermissionsCacheKey(companyId, userId);
  try {
    await redis.del(cacheKey);
  } catch {
    // Ignore error if Redis is unreachable
  }
}
