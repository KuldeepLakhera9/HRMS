import type pg from 'pg';
import { withTenant } from '@hrms/db';
import { getRedisClient } from '../redis/client.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const INITIAL_LOCKOUT_SECONDS = 15 * 60; // 15 minutes

/**
 * Redis-backed sliding window rate limiter.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const redisKey = `ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    const pipeline = redis.pipeline();
    // 1. Remove expired timestamps
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    // 2. Count requests in current window
    pipeline.zcard(redisKey);
    // 3. Add current request timestamp
    pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);
    // 4. Set expiry on the set
    pipeline.expire(redisKey, windowSeconds);

    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) || 0;

    const remaining = Math.max(0, limit - count - 1);
    const allowed = count < limit;

    return {
      allowed,
      remaining,
      resetSeconds: windowSeconds,
    };
  } catch {
    // If Redis fails, fail open gracefully to avoid blocking legitimate users
    return {
      allowed: true,
      remaining: 1,
      resetSeconds: windowSeconds,
    };
  }
}

/**
 * Records a failed login attempt for a user and calculates account lockout.
 * After 5 failures: locked for 15 minutes with exponential backoff.
 */
export async function recordFailedLogin(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<{ isLocked: boolean; lockedUntil?: Date | undefined }> {
  return await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      const userRes = await client.query<{ failed_attempts: number; locked_until: Date | null }>(
        `SELECT failed_attempts, locked_until FROM users
         WHERE company_id = $1 AND id = $2`,
        [companyId, userId],
      );

      if (userRes.rows.length === 0) {
        return { isLocked: false };
      }

      const currentAttempts = (userRes.rows[0]?.failed_attempts || 0) + 1;
      let lockedUntil: Date | null = null;
      let isLocked = false;

      if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
        isLocked = true;
        // Exponential backoff: 15m * 2^(attempts - 5), capped at 24 hours
        const multiplier = Math.min(Math.pow(2, currentAttempts - MAX_FAILED_ATTEMPTS), 96);
        const lockoutDurationMs = INITIAL_LOCKOUT_SECONDS * 1000 * multiplier;
        lockedUntil = new Date(Date.now() + lockoutDurationMs);
      }

      await client.query(
        `UPDATE users
         SET failed_attempts = $1,
             locked_until = $2
         WHERE company_id = $3 AND id = $4`,
        [currentAttempts, lockedUntil, companyId, userId],
      );

      return { isLocked, lockedUntil: lockedUntil ?? undefined };
    },
    poolOverride,
  );
}

/**
 * Resets failed login attempts after a successful login.
 */
export async function resetFailedLoginAttempts(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<void> {
  await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      await client.query(
        `UPDATE users
         SET failed_attempts = 0,
             locked_until = NULL,
             last_login_at = now()
         WHERE company_id = $1 AND id = $2`,
        [companyId, userId],
      );
    },
    poolOverride,
  );
}
