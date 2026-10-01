import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import {
  createSession,
  getSessionByToken,
  revokeSession,
  revokeAllUserSessions,
  recordFailedLogin,
  resetFailedLoginAttempts,
  createAuthToken,
  consumeAuthToken,
  checkRateLimit,
} from '@hrms/core';

describe('Sprint 1.1 Session, Rate Limiting & Auth Tokens Integration Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let userId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany(
      'Session Test Co',
      `session-test-${generateUuidV7()}.internal`,
    );

    userId = generateUuidV7();
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [userId, companyId, `session_user_${generateUuidV7()}@test.com`, 'test_hash'],
      );
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Opaque Session Management', () => {
    it('creates an opaque session, resolves it via token, and retrieves cached data', async () => {
      const { rawToken, sessionData } = await createSession({
        companyId,
        userId,
        clientType: 'web',
        ip: '127.0.0.1',
        userAgent: 'Vitest Test Agent',
        poolOverride: db.appPool,
      });

      expect(rawToken).toHaveLength(64);
      expect(sessionData.userId).toBe(userId);
      expect(sessionData.companyId).toBe(companyId);

      // Resolve session
      const resolved = await getSessionByToken(rawToken, db.appPool);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(sessionData.id);
      expect(resolved?.userId).toBe(userId);
    });

    it('revokes an active session so subsequent lookups return null', async () => {
      const { rawToken } = await createSession({
        companyId,
        userId,
        poolOverride: db.appPool,
      });

      const beforeRevoke = await getSessionByToken(rawToken, db.appPool);
      expect(beforeRevoke).not.toBeNull();

      await revokeSession(rawToken, db.appPool);

      const afterRevoke = await getSessionByToken(rawToken, db.appPool);
      expect(afterRevoke).toBeNull();
    });

    it('revokes all sessions for a user upon global logout / password reset', async () => {
      const sess1 = await createSession({ companyId, userId, clientOverride: db.appPool });
      const sess2 = await createSession({ companyId, userId, clientOverride: db.appPool });

      expect(await getSessionByToken(sess1.rawToken, db.appPool)).not.toBeNull();
      expect(await getSessionByToken(sess2.rawToken, db.appPool)).not.toBeNull();

      await revokeAllUserSessions(companyId, userId, db.appPool);

      expect(await getSessionByToken(sess1.rawToken, db.appPool)).toBeNull();
      expect(await getSessionByToken(sess2.rawToken, db.appPool)).toBeNull();
    });
  });

  describe('Rate Limiting & Account Lockout', () => {
    it('locks account after 5 consecutive failed login attempts', async () => {
      // 4 failures -> not locked
      for (let i = 0; i < 4; i++) {
        const res = await recordFailedLogin(companyId, userId, db.appPool);
        expect(res.isLocked).toBe(false);
      }

      // 5th failure -> locked
      const fifthRes = await recordFailedLogin(companyId, userId, db.appPool);
      expect(fifthRes.isLocked).toBe(true);
      expect(fifthRes.lockedUntil).toBeDefined();

      // Successful login resets failed attempts
      await resetFailedLoginAttempts(companyId, userId, db.appPool);
      const userRow = await withTenant(
        { companyId },
        async (_tx, client) => {
          return client.query(
            `SELECT failed_attempts, locked_until FROM users WHERE id = $1`,
            [userId],
          );
        },
        db.appPool,
      );
      expect(userRow.rows[0].failed_attempts).toBe(0);
      expect(userRow.rows[0].locked_until).toBeNull();
    });

    it('enforces Redis sliding window rate limiting', async () => {
      const ipKey = `ip-test-${generateUuidV7()}`;
      const limit = 3;
      const windowSeconds = 10;

      // 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const res = await checkRateLimit(ipKey, limit, windowSeconds);
        expect(res.allowed).toBe(true);
      }

      // 4th request must be rate limited
      const blockedRes = await checkRateLimit(ipKey, limit, windowSeconds);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
    });
  });

  describe('Single-Use Auth Tokens (Invites & Resets)', () => {
    it('creates single-use token and consumes it atomically once', async () => {
      const { rawToken } = await createAuthToken({
        companyId,
        userId,
        type: 'reset',
        ttlMinutes: 15,
        poolOverride: db.appPool,
      });

      // First consumption succeeds
      const consumed = await consumeAuthToken({
        rawToken,
        type: 'reset',
        poolOverride: db.appPool,
      });
      expect(consumed).not.toBeNull();
      expect(consumed?.userId).toBe(userId);
      expect(consumed?.companyId).toBe(companyId);

      // Second consumption must fail (single-use enforced)
      const secondConsume = await consumeAuthToken({
        rawToken,
        type: 'reset',
        poolOverride: db.appPool,
      });
      expect(secondConsume).toBeNull();
    });
  });
});
