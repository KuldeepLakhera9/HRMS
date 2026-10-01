import type pg from 'pg';
import { getAppPool } from '@hrms/db';
import { SCOPE_HIERARCHY, type PermissionScope } from '@hrms/shared';
import { getRedisClient } from '../redis/client.js';

const CACHE_TTL_SECONDS = 300; // 5 minutes

export function getEffectivePermissionsCacheKey(companyId: string, userId: string): string {
  return `eff:${companyId}:${userId}`;
}

/**
 * Computes and returns the union of permissions for a user across all assigned roles.
 * Widest scope wins for duplicate permission keys.
 * Caches in Redis for sub-millisecond route checks.
 */
export async function getEffectivePermissions(
  companyId: string,
  userId: string,
  clientOverride?: pg.PoolClient | pg.Pool,
): Promise<Record<string, PermissionScope>> {
  const redis = getRedisClient();
  const cacheKey = getEffectivePermissionsCacheKey(companyId, userId);

  // 1. Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Record<string, PermissionScope>;
    }
  } catch {
    // Redis unavailable, fallback to DB query
  }

  // 2. Query PostgreSQL
  const db = clientOverride ?? getAppPool();
  const res = await db.query<{ permission_key: string; scope: PermissionScope }>(
    `SELECT rp.permission_key, rp.scope
     FROM user_roles ur
     JOIN role_permissions rp ON ur.role_id = rp.role_id AND ur.company_id = rp.company_id
     WHERE ur.company_id = $1 AND ur.user_id = $2
       AND ur.deleted_at IS NULL AND rp.deleted_at IS NULL;`,
    [companyId, userId],
  );

  // 3. Aggregate permissions, widest scope wins
  const effective: Record<string, PermissionScope> = {};
  for (const row of res.rows) {
    const existing = effective[row.permission_key];
    if (!existing || SCOPE_HIERARCHY[row.scope] > SCOPE_HIERARCHY[existing]) {
      effective[row.permission_key] = row.scope;
    }
  }

  // 4. Cache in Redis
  try {
    await redis.set(cacheKey, JSON.stringify(effective), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal if cache write fails
  }

  return effective;
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
