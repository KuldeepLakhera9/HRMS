import type pg from 'pg';
import { getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import { generateSecureToken, hashToken } from './crypto.js';
import { getRedisClient } from '../redis/client.js';

export const IDLE_TIMEOUT_SECONDS = 30 * 60; // 30 minutes
export const ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60; // 12 hours
const LAST_SEEN_THROTTLE_SECONDS = 60; // Max 1 DB write per 60s per session

export interface SessionData {
  id: string;
  companyId: string;
  userId: string;
  clientType: 'web' | 'mobile' | 'api';
  ip?: string | undefined;
  userAgent?: string | undefined;
  mfaVerifiedAt?: string | undefined;
  stepUpUntil?: string | undefined;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export function getSessionCacheKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

export function getLastSeenCacheKey(sessionId: string): string {
  return `session:last_seen:${sessionId}`;
}

/**
 * Creates a new opaque session, stores the hash in PostgreSQL and caches in Redis.
 * Returns the plaintext opaque token to be delivered via HttpOnly cookie.
 */
export async function createSession(params: {
  companyId: string;
  userId: string;
  clientType?: 'web' | 'mobile' | 'api' | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceLabel?: string | undefined;
  mfaVerified?: boolean | undefined;
  poolOverride?: pg.Pool | undefined;
}): Promise<{ sessionId: string; rawToken: string; sessionData: SessionData }> {
  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const familyId = generateUuidV7();
  const sessionId = generateUuidV7();

  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + IDLE_TIMEOUT_SECONDS * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_SECONDS * 1000);
  const mfaVerifiedAt = params.mfaVerified ? now : undefined;

  await withTenant(
    { companyId: params.companyId, userId: params.userId },
    async (_tx, client) => {
      await client.query(
        `INSERT INTO sessions (
           id, company_id, user_id, token_hash, family_id, client_type,
           ip, user_agent, device_label, mfa_verified_at,
           last_seen_at, idle_expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          sessionId,
          params.companyId,
          params.userId,
          tokenHash,
          familyId,
          params.clientType || 'web',
          params.ip || null,
          params.userAgent || null,
          params.deviceLabel || null,
          mfaVerifiedAt || null,
          now,
          idleExpiresAt,
          absoluteExpiresAt,
        ],
      );
    },
    params.poolOverride,
  );

  const sessionData: SessionData = {
    id: sessionId,
    companyId: params.companyId,
    userId: params.userId,
    clientType: params.clientType || 'web',
    ip: params.ip,
    userAgent: params.userAgent,
    mfaVerifiedAt: mfaVerifiedAt?.toISOString(),
    idleExpiresAt: idleExpiresAt.toISOString(),
    absoluteExpiresAt: absoluteExpiresAt.toISOString(),
  };

  // Cache in Redis with idle TTL
  try {
    const redis = getRedisClient();
    await redis.set(
      getSessionCacheKey(tokenHash),
      JSON.stringify(sessionData),
      'EX',
      IDLE_TIMEOUT_SECONDS,
    );
  } catch {
    // Non-fatal if Redis write fails
  }

  return { sessionId, rawToken, sessionData };
}

/**
 * Resolves an active session by raw token.
 * Validates expiration and sliding window, updating last_seen with throttling.
 */
export async function getSessionByToken(
  rawToken: string,
  poolOverride?: pg.Pool,
): Promise<SessionData | null> {
  const tokenHash = hashToken(rawToken);
  const redis = getRedisClient();
  const cacheKey = getSessionCacheKey(tokenHash);

  let session: SessionData | null = null;

  // 1. Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      session = JSON.parse(cached) as SessionData;
    }
  } catch {
    // Fallback to PostgreSQL
  }

  // 2. Fallback to PostgreSQL security-definer function if cache miss
  if (!session) {
    const db = poolOverride ?? getAppPool();
    const res = await db.query<{
      id: string;
      company_id: string;
      user_id: string;
      client_type: 'web' | 'mobile' | 'api';
      ip: string | null;
      user_agent: string | null;
      mfa_verified_at: Date | null;
      step_up_until: Date | null;
      idle_expires_at: Date;
      absolute_expires_at: Date;
    }>(
      `SELECT id, company_id, user_id, client_type, ip::text, user_agent,
              mfa_verified_at, step_up_until, idle_expires_at, absolute_expires_at
       FROM lookup_session_by_hash($1)`,
      [tokenHash],
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0]!;
    session = {
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      clientType: row.client_type,
      ip: row.ip || undefined,
      userAgent: row.user_agent || undefined,
      mfaVerifiedAt: row.mfa_verified_at ? new Date(row.mfa_verified_at).toISOString() : undefined,
      stepUpUntil: row.step_up_until ? new Date(row.step_up_until).toISOString() : undefined,
      idleExpiresAt: new Date(row.idle_expires_at).toISOString(),
      absoluteExpiresAt: new Date(row.absolute_expires_at).toISOString(),
    };

    // Re-cache in Redis
    try {
      const remainingIdle = Math.max(
        1,
        Math.floor((new Date(session.idleExpiresAt).getTime() - Date.now()) / 1000),
      );
      await redis.set(cacheKey, JSON.stringify(session), 'EX', remainingIdle);
    } catch {
      // Non-fatal
    }
  }

  if (!session) {
    return null;
  }

  // 3. Check expiration
  const now = Date.now();
  if (
    new Date(session.idleExpiresAt).getTime() <= now ||
    new Date(session.absoluteExpiresAt).getTime() <= now
  ) {
    await revokeSession(rawToken, poolOverride);
    return null;
  }

  // 4. Throttled last_seen update in PostgreSQL (at most once every 60s per session)
  try {
    const lastSeenKey = getLastSeenCacheKey(session.id);
    const hasRecentSeen = await redis.get(lastSeenKey);

    if (!hasRecentSeen) {
      await redis.set(lastSeenKey, '1', 'EX', LAST_SEEN_THROTTLE_SECONDS);
      const db = poolOverride ?? getAppPool();
      const newIdleExpiresAt = new Date(now + IDLE_TIMEOUT_SECONDS * 1000);

      // Slide idle expiration using touch function
      await db.query(
        `SELECT touch_session_by_id($1, $2)`,
        [session.id, newIdleExpiresAt],
      );

      session.idleExpiresAt = newIdleExpiresAt.toISOString();
      await redis.set(cacheKey, JSON.stringify(session), 'EX', IDLE_TIMEOUT_SECONDS);
    }
  } catch {
    // Non-fatal
  }

  return session;
}

/**
 * Revokes a session, setting revoked_at in PostgreSQL and deleting from Redis.
 */
export async function revokeSession(
  rawToken: string,
  poolOverride?: pg.Pool,
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const redis = getRedisClient();

  // Remove from Redis
  try {
    await redis.del(getSessionCacheKey(tokenHash));
  } catch {
    // Non-fatal
  }

  // Mark revoked in DB using security definer function
  const db = poolOverride ?? getAppPool();
  await db.query(`SELECT revoke_session_by_hash($1)`, [tokenHash]);
}

/**
 * Revokes all active sessions for a user (e.g. on password reset or admin revocation).
 */
export async function revokeAllUserSessions(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<void> {
  await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      // Find all active tokens to remove from Redis
      const activeSessions = await client.query<{ token_hash: string }>(
        `SELECT token_hash FROM sessions
         WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [companyId, userId],
      );

      const redis = getRedisClient();
      for (const row of activeSessions.rows) {
        try {
          await redis.del(getSessionCacheKey(row.token_hash));
        } catch {
          // Non-fatal
        }
      }

      // Revoke in DB
      await client.query(
        `UPDATE sessions
         SET revoked_at = now()
         WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [companyId, userId],
      );
    },
    poolOverride,
  );
}
