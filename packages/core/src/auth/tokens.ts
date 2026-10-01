import type pg from 'pg';
import { getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import { generateSecureToken, hashToken } from './crypto.js';

export const INVITE_TOKEN_TTL_MINUTES = 24 * 60; // 24 hours
export const RESET_TOKEN_TTL_MINUTES = 30; // 30 minutes

export interface AuthTokenRecord {
  id: string;
  companyId: string;
  userId: string;
  type: 'invite' | 'reset';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Creates a single-use token (invite or password reset) and returns the raw plaintext token.
 */
export async function createAuthToken(params: {
  companyId: string;
  userId: string;
  type: 'invite' | 'reset';
  ttlMinutes?: number | undefined;
  poolOverride?: pg.Pool | undefined;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const ttl = params.ttlMinutes || (params.type === 'invite' ? INVITE_TOKEN_TTL_MINUTES : RESET_TOKEN_TTL_MINUTES);
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  const id = generateUuidV7();

  await withTenant(
    { companyId: params.companyId, userId: params.userId },
    async (_tx, client) => {
      await client.query(
        `INSERT INTO auth_tokens (id, company_id, user_id, type, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, params.companyId, params.userId, params.type, tokenHash, expiresAt],
      );
    },
    params.poolOverride,
  );

  return { rawToken, expiresAt };
}

/**
 * Validates and atomically consumes a single-use auth token within a transaction.
 * If expired or already used, returns null.
 */
export async function consumeAuthToken(params: {
  rawToken: string;
  type: 'invite' | 'reset';
  poolOverride?: pg.Pool | undefined;
}): Promise<{ companyId: string; userId: string } | null> {
  const tokenHash = hashToken(params.rawToken);
  const db = params.poolOverride ?? getAppPool();

  const res = await db.query<{ company_id: string; user_id: string }>(
    `SELECT company_id, user_id FROM consume_auth_token_by_hash($1, $2)`,
    [tokenHash, params.type],
  );

  if (res.rows.length === 0) {
    return null;
  }

  return {
    companyId: res.rows[0]!.company_id,
    userId: res.rows[0]!.user_id,
  };
}
