import type pg from 'pg';
import { getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import { UnauthorizedError, ForbiddenError } from '@hrms/shared';
import { generateSecureToken, hashToken } from './crypto.js';
import { getRedisClient } from '../redis/client.js';

export const IDLE_TIMEOUT_SECONDS = 30 * 60; // 30 minutes
export const ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60; // 12 hours
export const STEP_UP_DURATION_SECONDS = 10 * 60; // 10 minutes
const LAST_SEEN_THROTTLE_SECONDS = 60; // Max 1 DB write per 60s per session

export interface SessionData {
  id: string;
  companyId: string;
  userId: string;
  familyId: string;
  clientType: 'web' | 'mobile' | 'api';
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceLabel?: string | undefined;
  mfaVerifiedAt?: string | undefined;
  stepUpUntil?: string | undefined;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface UserSessionView {
  id: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  clientType: string;
  deviceLabel?: string | undefined;
  mfaVerifiedAt?: string | undefined;
  stepUpUntil?: string | undefined;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export function getSessionCacheKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

export function getLastSeenCacheKey(sessionId: string): string {
  return `session:last_seen:${sessionId}`;
}

export function getUsedRefreshCacheKey(refreshHash: string): string {
  return `used_refresh:${refreshHash}`;
}

/**
 * Creates a new opaque session, stores token and refresh hashes in PostgreSQL, and caches in Redis.
 * Returns both rawToken and rawRefreshToken.
 */
export async function createSession(params: {
  companyId: string;
  userId: string;
  familyId?: string | undefined;
  clientType?: 'web' | 'mobile' | 'api' | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceLabel?: string | undefined;
  mfaVerified?: boolean | undefined;
  poolOverride?: pg.Pool | undefined;
}): Promise<{
  sessionId: string;
  rawToken: string;
  rawRefreshToken: string;
  sessionData: SessionData;
}> {
  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const rawRefreshToken = generateSecureToken(32);
  const refreshHash = hashToken(rawRefreshToken);
  const familyId = params.familyId || generateUuidV7();
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
           id, company_id, user_id, token_hash, refresh_hash, family_id, client_type,
           ip, user_agent, device_label, mfa_verified_at,
           last_seen_at, idle_expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          sessionId,
          params.companyId,
          params.userId,
          tokenHash,
          refreshHash,
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
    familyId,
    clientType: params.clientType || 'web',
    ip: params.ip,
    userAgent: params.userAgent,
    deviceLabel: params.deviceLabel,
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

  return { sessionId, rawToken, rawRefreshToken, sessionData };
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
      family_id: string;
      client_type: 'web' | 'mobile' | 'api';
      ip: string | null;
      user_agent: string | null;
      mfa_verified_at: Date | null;
      step_up_until: Date | null;
      idle_expires_at: Date;
      absolute_expires_at: Date;
    }>(
      `SELECT id, company_id, user_id, family_id, client_type, ip::text, user_agent,
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
      familyId: row.family_id,
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

  try {
    await redis.del(getSessionCacheKey(tokenHash));
  } catch {
    // Non-fatal
  }

  const db = poolOverride ?? getAppPool();
  await db.query(`SELECT revoke_session_by_hash($1)`, [tokenHash]);
}

/**
 * Revokes a specific session by session ID.
 */
export async function revokeSessionById(
  companyId: string,
  userId: string,
  sessionId: string,
  poolOverride?: pg.Pool,
): Promise<boolean> {
  let tokenHash: string | undefined;

  await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      const res = await client.query<{ token_hash: string }>(
        `UPDATE sessions
         SET revoked_at = now()
         WHERE company_id = $1 AND id = $2 AND revoked_at IS NULL
         RETURNING token_hash`,
        [companyId, sessionId],
      );
      if (res.rows.length > 0) {
        tokenHash = res.rows[0]?.token_hash;
      }
    },
    poolOverride,
  );

  if (tokenHash) {
    try {
      const redis = getRedisClient();
      await redis.del(getSessionCacheKey(tokenHash));
    } catch {
      // Non-fatal
    }
    return true;
  }

  return false;
}

/**
 * Lists active sessions for a user.
 */
export async function listUserSessions(
  companyId: string,
  userId: string,
  currentSessionId?: string,
  poolOverride?: pg.Pool,
): Promise<UserSessionView[]> {
  let sessions: UserSessionView[] = [];

  await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      const res = await client.query<{
        id: string;
        ip: string | null;
        user_agent: string | null;
        client_type: string;
        device_label: string | null;
        mfa_verified_at: Date | null;
        step_up_until: Date | null;
        last_seen_at: Date;
        created_at: Date;
      }>(
        `SELECT id, ip::text, user_agent, client_type, device_label,
                mfa_verified_at, step_up_until, last_seen_at, created_at
         FROM sessions
         WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > now() AND absolute_expires_at > now()
         ORDER BY last_seen_at DESC`,
        [companyId, userId],
      );

      sessions = res.rows.map(row => ({
        id: row.id,
        ip: row.ip || undefined,
        userAgent: row.user_agent || undefined,
        clientType: row.client_type,
        deviceLabel: row.device_label || undefined,
        mfaVerifiedAt: row.mfa_verified_at ? new Date(row.mfa_verified_at).toISOString() : undefined,
        stepUpUntil: row.step_up_until ? new Date(row.step_up_until).toISOString() : undefined,
        lastSeenAt: new Date(row.last_seen_at).toISOString(),
        createdAt: new Date(row.created_at).toISOString(),
        isCurrent: Boolean(currentSessionId && row.id === currentSessionId),
      }));
    },
    poolOverride,
  );

  return sessions;
}

/**
 * Revokes all active sessions for a user (e.g. on password reset or admin revocation).
 */
export async function revokeAllUserSessions(
  companyId: string,
  userId: string,
  poolOverride?: pg.Pool,
): Promise<number> {
  let revokedCount = 0;

  await withTenant(
    { companyId, userId },
    async (_tx, client) => {
      const activeSessions = await client.query<{ token_hash: string }>(
        `SELECT token_hash FROM sessions
         WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [companyId, userId],
      );

      revokedCount = activeSessions.rows.length;
      const redis = getRedisClient();
      for (const row of activeSessions.rows) {
        try {
          await redis.del(getSessionCacheKey(row.token_hash));
        } catch {
          // Non-fatal
        }
      }

      await client.query(
        `UPDATE sessions
         SET revoked_at = now()
         WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [companyId, userId],
      );
    },
    poolOverride,
  );

  return revokedCount;
}

/**
 * Rotates an active refresh token and access token.
 * Detects refresh token reuse: if an old/used refresh token is presented,
 * immediately revokes all sessions in that family.
 */
export async function rotateRefreshToken(params: {
  refreshToken: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  poolOverride?: pg.Pool | undefined;
}): Promise<{
  token: string;
  refreshToken: string;
  sessionData: SessionData;
}> {
  const refreshHash = hashToken(params.refreshToken);
  const redis = getRedisClient();
  const db = params.poolOverride ?? getAppPool();

  // 1. Check if token was already used (reuse detection in Redis cache)
  const usedFamilyId = await (async () => {
    try {
      return await redis.get(getUsedRefreshCacheKey(refreshHash));
    } catch {
      return null;
    }
  })();

  if (usedFamilyId) {
    // REUSE DETECTED! Revoke entire family in DB and Redis
    const revokedTokens = await db.query<{ token_hash: string }>(
      `SELECT token_hash FROM revoke_session_family($1)`,
      [usedFamilyId],
    );
    for (const row of revokedTokens.rows) {
      try {
        await redis.del(getSessionCacheKey(row.token_hash));
      } catch {
        // Non-fatal
      }
    }
    throw new UnauthorizedError('Token reuse detected. All sessions in this family have been revoked.');
  }

  // 2. Lookup session in DB by refresh hash
  const res = await db.query<{
    id: string;
    company_id: string;
    user_id: string;
    family_id: string;
    token_hash: string;
    client_type: 'web' | 'mobile' | 'api';
    revoked_at: Date | null;
    idle_expires_at: Date;
    absolute_expires_at: Date;
  }>(
    `SELECT id, company_id, user_id, family_id, token_hash, client_type,
            revoked_at, idle_expires_at, absolute_expires_at
     FROM lookup_session_by_refresh_hash($1)`,
    [refreshHash],
  );

  if (res.rows.length === 0) {
    // Token not found in active sessions; check if it belonged to a revoked session in DB
    const historicRes = await db.query<{ family_id: string }>(
      `SELECT family_id FROM sessions WHERE refresh_hash = $1 LIMIT 1`,
      [refreshHash],
    );
    if (historicRes.rows.length > 0) {
      const familyId = historicRes.rows[0]?.family_id;
      if (familyId) {
        const revoked = await db.query<{ token_hash: string }>(
          `SELECT token_hash FROM revoke_session_family($1)`,
          [familyId],
        );
        for (const row of revoked.rows) {
          try {
            await redis.del(getSessionCacheKey(row.token_hash));
          } catch {
            // Non-fatal
          }
        }
      }
      throw new UnauthorizedError('Token reuse detected. All sessions in this family have been revoked.');
    }
    throw new UnauthorizedError('Invalid or expired refresh token.');
  }

  const sessionRow = res.rows[0]!;

  if (
    sessionRow.revoked_at ||
    new Date(sessionRow.idle_expires_at).getTime() <= Date.now() ||
    new Date(sessionRow.absolute_expires_at).getTime() <= Date.now()
  ) {
    throw new UnauthorizedError('Invalid or expired refresh token.');
  }

  // 3. Mark old refresh token as used in Redis for reuse detection (keep for 24h)
  try {
    await redis.set(getUsedRefreshCacheKey(refreshHash), sessionRow.family_id, 'EX', 86400);
  } catch {
    // Non-fatal
  }

  // 4. Generate new pair
  const newRawToken = generateSecureToken(32);
  const newTokenHash = hashToken(newRawToken);
  const newRawRefreshToken = generateSecureToken(32);
  const newRefreshHash = hashToken(newRawRefreshToken);

  const now = new Date();
  const newIdleExpiresAt = new Date(now.getTime() + IDLE_TIMEOUT_SECONDS * 1000);

  // 5. Update session in PostgreSQL using security definer function (safe from unauthenticated RLS barrier)
  await db.query(
    `SELECT rotate_session_tokens($1, $2, $3, $4, $5, $6)`,
    [
      sessionRow.id,
      newTokenHash,
      newRefreshHash,
      newIdleExpiresAt,
      params.ip || null,
      params.userAgent || null,
    ],
  );

  // 6. Invalidate old token cache & set new session cache
  try {
    await redis.del(getSessionCacheKey(sessionRow.token_hash));
  } catch {
    // Non-fatal
  }

  const sessionData: SessionData = {
    id: sessionRow.id,
    companyId: sessionRow.company_id,
    userId: sessionRow.user_id,
    familyId: sessionRow.family_id,
    clientType: sessionRow.client_type,
    ip: params.ip,
    userAgent: params.userAgent,
    idleExpiresAt: newIdleExpiresAt.toISOString(),
    absoluteExpiresAt: new Date(sessionRow.absolute_expires_at).toISOString(),
  };

  try {
    await redis.set(
      getSessionCacheKey(newTokenHash),
      JSON.stringify(sessionData),
      'EX',
      IDLE_TIMEOUT_SECONDS,
    );
  } catch {
    // Non-fatal
  }

  return {
    token: newRawToken,
    refreshToken: newRawRefreshToken,
    sessionData,
  };
}

/**
 * Activates step-up authentication for the specified session (10-minute window).
 */
export async function setStepUp(
  sessionId: string,
  durationSeconds = STEP_UP_DURATION_SECONDS,
  poolOverride?: pg.Pool,
): Promise<{ stepUpUntil: string }> {
  const db = poolOverride ?? getAppPool();
  const stepUpUntil = new Date(Date.now() + durationSeconds * 1000);

  const res = await db.query<{ token_hash: string }>(
    `SELECT token_hash FROM set_session_step_up_by_id($1, $2)`,
    [sessionId, stepUpUntil],
  );

  if (res.rows.length === 0) {
    throw new UnauthorizedError('Active session not found.');
  }

  const tokenHash = res.rows[0]?.token_hash;
  if (tokenHash) {
    try {
      const redis = getRedisClient();
      const cacheKey = getSessionCacheKey(tokenHash);
      const cached = await redis.get(cacheKey);
      if (cached) {
        const session = JSON.parse(cached) as SessionData;
        session.stepUpUntil = stepUpUntil.toISOString();
        const ttl = await redis.ttl(cacheKey);
        await redis.set(cacheKey, JSON.stringify(session), 'EX', Math.max(1, ttl));
      }
    } catch {
      // Non-fatal
    }
  }

  return { stepUpUntil: stepUpUntil.toISOString() };
}

/**
 * Step-up authentication guard for sensitive operations.
 * Throws ForbiddenError if step_up_until is absent or expired.
 */
export function requireStepUp(session: SessionData | null | undefined): void {
  if (!session) {
    throw new UnauthorizedError('Authentication is required.');
  }

  if (!session.stepUpUntil || new Date(session.stepUpUntil).getTime() <= Date.now()) {
    throw new ForbiddenError(
      'Step-up authentication is required to perform this sensitive action.',
      { code: 'STEP_UP_REQUIRED' },
    );
  }
}
