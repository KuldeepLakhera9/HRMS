import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import {
  AuthService,
  createSession,
  getSessionByToken,
  rotateRefreshToken,
  requireStepUp,
  listUserSessions,
  revokeSessionById,
  hashPassword,
} from '@hrms/core';

describe('Sprint 1.2 Auth: Sessions, Refresh Rotation & Step-Up Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let testUserId: string;
  const testPassword = 'Password@123456';
  let authService: AuthService;

  beforeAll(async () => {
    db = await setupTestDatabase();
    authService = new AuthService();
    companyId = await db.createCompany('Security Corp', `sec-${generateUuidV7()}.internal`);
    testUserId = generateUuidV7();

    const passwordHash = await hashPassword(testPassword);

    await withTenant({ companyId, userId: testUserId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [testUserId, companyId, `user-${generateUuidV7()}@sec.internal`, passwordHash],
      );
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists active user sessions and allows individual revocation', async () => {
    // 1. Create 2 sessions for the user
    const session1 = await createSession({
      companyId,
      userId: testUserId,
      deviceLabel: 'MacBook Pro Chrome',
      ip: '192.168.1.10',
      poolOverride: db.appPool,
    });

    const session2 = await createSession({
      companyId,
      userId: testUserId,
      deviceLabel: 'iPhone 15 Safari',
      ip: '192.168.1.20',
      poolOverride: db.appPool,
    });

    // 2. List sessions with session1 as current
    const sessions = await listUserSessions(
      companyId,
      testUserId,
      session1.sessionId,
      db.appPool,
    );

    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const s1 = sessions.find(s => s.id === session1.sessionId);
    const s2 = sessions.find(s => s.id === session2.sessionId);

    expect(s1).toBeDefined();
    expect(s1?.isCurrent).toBe(true);
    expect(s1?.deviceLabel).toBe('MacBook Pro Chrome');

    expect(s2).toBeDefined();
    expect(s2?.isCurrent).toBe(false);
    expect(s2?.deviceLabel).toBe('iPhone 15 Safari');

    // 3. Revoke session 2
    const revoked = await revokeSessionById(
      companyId,
      testUserId,
      session2.sessionId,
      db.appPool,
    );
    expect(revoked).toBe(true);

    // 4. Session 2 cannot be resolved anymore
    const resolvedSession2 = await getSessionByToken(session2.rawToken, db.appPool);
    expect(resolvedSession2).toBeNull();

    // Session 1 remains active
    const resolvedSession1 = await getSessionByToken(session1.rawToken, db.appPool);
    expect(resolvedSession1).not.toBeNull();
  });

  it('rotates refresh token and detects reuse revoking the entire token family', async () => {
    // 1. Create a session with refresh token
    const initial = await createSession({
      companyId,
      userId: testUserId,
      poolOverride: db.appPool,
    });

    const refreshToken1 = initial.rawRefreshToken;
    const initialFamilyId = initial.sessionData.familyId;

    // 2. First rotation: legitimate refresh
    const rotation1 = await rotateRefreshToken({
      refreshToken: refreshToken1,
      poolOverride: db.appPool,
    });

    expect(rotation1.token).toBeDefined();
    expect(rotation1.refreshToken).toBeDefined();
    expect(rotation1.refreshToken).not.toBe(refreshToken1);
    expect(rotation1.sessionData.familyId).toBe(initialFamilyId);

    // Verify new token is valid
    const activeSession = await getSessionByToken(rotation1.token, db.appPool);
    expect(activeSession).not.toBeNull();

    // 3. Second rotation: attacker attempts to reuse refreshToken1
    await expect(
      rotateRefreshToken({
        refreshToken: refreshToken1,
        poolOverride: db.appPool,
      }),
    ).rejects.toThrow(/reuse detected/i);

    // 4. Verification: Entire family revoked! Even rotation1.token is now invalid!
    const revokedActiveSession = await getSessionByToken(rotation1.token, db.appPool);
    expect(revokedActiveSession).toBeNull();
  });

  it('activates step-up authentication and enforces requireStepUp guard', async () => {
    const session = await createSession({
      companyId,
      userId: testUserId,
      poolOverride: db.appPool,
    });

    // 1. Initially step-up is not active -> requireStepUp throws
    expect(() => requireStepUp(session.sessionData)).toThrow(/step-up authentication is required/i);

    // 2. Activate step-up via password verification
    const stepUpResult = await authService.stepUp({
      ctx: {
        companyId,
        userId: testUserId,
        sessionId: session.sessionId,
        requestId: 'req-stepup-test',
        isAuthenticated: true,
        roles: [],
        permissions: [],
      },
      sessionId: session.sessionId,
      password: testPassword,
      poolOverride: db.appPool,
    });

    expect(stepUpResult.stepUpUntil).toBeDefined();
    expect(new Date(stepUpResult.stepUpUntil).getTime()).toBeGreaterThan(Date.now());

    // 3. Verify updated sessionData satisfies requireStepUp
    const elevatedSession = await getSessionByToken(session.rawToken, db.appPool);
    expect(elevatedSession?.stepUpUntil).toBeDefined();
    expect(() => requireStepUp(elevatedSession)).not.toThrow();

    // 4. Expired step-up triggers failure
    const expiredSession = {
      ...elevatedSession!,
      stepUpUntil: new Date(Date.now() - 5000).toISOString(),
    };
    expect(() => requireStepUp(expiredSession)).toThrow(/step-up authentication is required/i);
  });
});
