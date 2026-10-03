import type pg from 'pg';
import { getAppPool, withTenant } from '@hrms/db';
import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { verifyPassword, verifyDummyPassword, hashPassword } from './password.js';
import { validatePasswordPolicy } from './password-policy.js';
import { verifyTotpCode } from './totp.js';
import { decryptSecret } from './crypto.js';
import {
  createSession,
  revokeSession,
  revokeSessionById,
  listUserSessions,
  revokeAllUserSessions,
  rotateRefreshToken,
  setStepUp,
  type SessionData,
  type UserSessionView,
  STEP_UP_DURATION_SECONDS,
} from './session.js';
import {
  recordFailedLogin,
  resetFailedLoginAttempts,
} from './rate-limiter.js';
import {
  createAuthToken,
  consumeAuthToken,
} from './tokens.js';
import { AuditService } from '../audit/service.js';
import { getUserAuthorization } from '../rbac/effective-permissions.js';

export interface UserLookupResult {
  id: string;
  company_id: string;
  email: string;
  password_hash: string;
  status: string;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  failed_attempts: number;
  locked_until: Date | null;
}

export interface LoginResult {
  mfaRequired?: boolean | undefined;
  tempUserId?: string | undefined;
  tempCompanyId?: string | undefined;
  rawToken?: string | undefined;
  rawRefreshToken?: string | undefined;
  sessionId?: string | undefined;
  sessionData?: SessionData | undefined;
  user?: {
    id: string;
    companyId: string;
    email: string;
    roles: string[];
    permissions: string[];
  } | undefined;
}

export class AuthService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Secure login workflow with Argon2id, lockout prevention, constant-time dummy verify,
   * MFA support, opaque session creation, and audit logging.
   */
  async login(params: {
    email: string;
    password: string;
    mfaCode?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
    requestId?: string | undefined;
    poolOverride?: pg.Pool | undefined;
  }): Promise<LoginResult> {
    const db = params.poolOverride ?? getAppPool();

    // 1. Look up user by email
    const res = await db.query<UserLookupResult>(
      `SELECT id, company_id, email, password_hash, status, mfa_enabled,
              mfa_secret_enc, failed_attempts, locked_until
       FROM lookup_user_by_email($1)`,
      [params.email.toLowerCase().trim()],
    );

    const user = res.rows[0];

    // 2. User not found -> execute constant-time dummy verification
    if (!user) {
      await verifyDummyPassword(params.password);
      throw new UnauthorizedError('Invalid email or password.');
    }

    // 3. Check account lockout
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new ForbiddenError(
        'Account is temporarily locked due to too many failed attempts. Please try again later.',
      );
    }

    if (user.status !== 'active') {
      throw new ForbiddenError(`Account is not active (status: ${user.status}).`);
    }

    // 4. Verify password
    const isPasswordValid = await verifyPassword(params.password, user.password_hash);
    if (!isPasswordValid) {
      await recordFailedLogin(user.company_id, user.id, params.poolOverride);
      throw new UnauthorizedError('Invalid email or password.');
    }

    // 5. Handle MFA requirement
    if (user.mfa_enabled && !params.mfaCode) {
      return {
        mfaRequired: true,
        tempUserId: user.id,
        tempCompanyId: user.company_id,
      };
    }

    // 6. Verify MFA if provided/required
    if (user.mfa_enabled && params.mfaCode) {
      if (!user.mfa_secret_enc) {
        throw new UnauthorizedError('MFA is misconfigured for this account.');
      }

      const totpSecret = decryptSecret(user.mfa_secret_enc);
      const isMfaValid = verifyTotpCode(totpSecret, params.mfaCode);

      if (!isMfaValid) {
        throw new UnauthorizedError('Invalid MFA verification code.');
      }
    }

    // 7. Reset failed login attempts on success
    await resetFailedLoginAttempts(user.company_id, user.id, params.poolOverride);

    // 8. Create session
    const { rawToken, rawRefreshToken, sessionId, sessionData } = await createSession({
      companyId: user.company_id,
      userId: user.id,
      clientType: 'web',
      ip: params.ip,
      userAgent: params.userAgent,
      mfaVerified: user.mfa_enabled,
      poolOverride: params.poolOverride,
    });

    // 9. Fetch effective permissions & roles
    const authData = await getUserAuthorization(
      user.company_id,
      user.id,
      params.poolOverride,
    );

    // 10. Audit log
    await this.auditService.recordEvent(
      {
        companyId: user.company_id,
        userId: user.id,
        requestId: params.requestId || 'req-login-success',
        ip: params.ip,
        userAgent: params.userAgent,
        isAuthenticated: true,
      },
      {
        action: 'auth.login.success',
        entity: 'sessions',
        entityId: sessionId,
        meta: { mfaUsed: user.mfa_enabled },
        poolOverride: params.poolOverride,
      },
    );

    return {
      rawToken,
      rawRefreshToken,
      sessionId,
      sessionData,
      user: {
        id: user.id,
        companyId: user.company_id,
        email: user.email,
        roles: authData.roles,
        permissions: authData.permissions,
      },
    };
  }

  /**
   * Refreshes access token using rotating refresh token.
   * Revokes the whole family on reuse detection.
   */
  async refresh(params: {
    refreshToken: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
    poolOverride?: pg.Pool | undefined;
  }): Promise<{ token: string; refreshToken: string; sessionData: SessionData }> {
    return rotateRefreshToken({
      refreshToken: params.refreshToken,
      ip: params.ip,
      userAgent: params.userAgent,
      poolOverride: params.poolOverride,
    });
  }

  /**
   * Step-up authentication verification.
   * Validates password or TOTP, then elevates session for 10 minutes.
   */
  async stepUp(params: {
    ctx: RequestContext;
    sessionId: string;
    password?: string | undefined;
    totpCode?: string | undefined;
    poolOverride?: pg.Pool | undefined;
  }): Promise<{ stepUpUntil: string }> {
    if (!params.ctx.isAuthenticated || !params.ctx.userId) {
      throw new UnauthorizedError('Authentication is required.');
    }

    // Look up user credentials within tenant context (RLS-safe)
    const user = await withTenant(
      params.ctx,
      async (_tx, client) => {
        const userRes = await client.query<{
          password_hash: string;
          mfa_enabled: boolean;
          mfa_secret_enc: string | null;
        }>(
          `SELECT password_hash, mfa_enabled, mfa_secret_enc
           FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [params.ctx.userId, params.ctx.companyId],
        );
        return userRes.rows[0];
      },
      params.poolOverride,
    );

    if (!user) {
      throw new UnauthorizedError('User account not found.');
    }

    let verified = false;

    if (params.password) {
      verified = await verifyPassword(params.password, user.password_hash);
    } else if (params.totpCode && user.mfa_enabled && user.mfa_secret_enc) {
      const totpSecret = decryptSecret(user.mfa_secret_enc);
      verified = verifyTotpCode(totpSecret, params.totpCode);
    }

    if (!verified) {
      throw new UnauthorizedError('Step-up verification failed. Invalid credentials.');
    }

    const { stepUpUntil } = await setStepUp(
      params.sessionId,
      STEP_UP_DURATION_SECONDS,
      params.poolOverride,
    );

    // Record audit entry
    await this.auditService.recordEvent(params.ctx, {
      action: 'auth.step_up.success',
      entity: 'sessions',
      entityId: params.sessionId,
      meta: { stepUpUntil },
      poolOverride: params.poolOverride,
    });

    return { stepUpUntil };
  }

  /**
   * Lists active sessions for current user.
   */
  async listSessions(params: {
    ctx: RequestContext;
    currentSessionId?: string | undefined;
    poolOverride?: pg.Pool | undefined;
  }): Promise<UserSessionView[]> {
    if (!params.ctx.isAuthenticated || !params.ctx.userId) {
      throw new UnauthorizedError('Authentication is required.');
    }

    return listUserSessions(
      params.ctx.companyId,
      params.ctx.userId,
      params.currentSessionId,
      params.poolOverride,
    );
  }

  /**
   * Revokes a session belonging to the caller.
   */
  async revokeSession(params: {
    ctx: RequestContext;
    sessionId: string;
    poolOverride?: pg.Pool | undefined;
  }): Promise<{ success: boolean }> {
    if (!params.ctx.isAuthenticated || !params.ctx.userId) {
      throw new UnauthorizedError('Authentication is required.');
    }

    const success = await revokeSessionById(
      params.ctx.companyId,
      params.ctx.userId,
      params.sessionId,
      params.poolOverride,
    );

    if (success) {
      await this.auditService.recordEvent(params.ctx, {
        action: 'auth.session.revoke',
        entity: 'sessions',
        entityId: params.sessionId,
        poolOverride: params.poolOverride,
      });
    }

    return { success };
  }

  /**
   * Admin revokes all sessions for a target user.
   */
  async adminRevokeUserSessions(params: {
    ctx: RequestContext;
    targetUserId: string;
    poolOverride?: pg.Pool | undefined;
  }): Promise<{ revokedCount: number }> {
    const revokedCount = await revokeAllUserSessions(
      params.ctx.companyId,
      params.targetUserId,
      params.poolOverride,
    );

    await this.auditService.recordEvent(params.ctx, {
      action: 'auth.session.admin_revoke',
      entity: 'users',
      entityId: params.targetUserId,
      meta: { revokedCount },
      poolOverride: params.poolOverride,
    });

    return { revokedCount };
  }

  /**
   * Revokes the active session and logs the logout event.
   */
  async logout(rawToken: string, ctx: RequestContext, poolOverride?: pg.Pool): Promise<void> {
    await revokeSession(rawToken, poolOverride);

    if (ctx.isAuthenticated && ctx.userId) {
      await this.auditService.recordEvent(ctx, {
        action: 'auth.logout',
        entity: 'sessions',
        poolOverride,
      });
    }
  }

  /**
   * Retrieves profile, roles, and permissions of the currently authenticated user.
   */
  async getCurrentUser(ctx: RequestContext, poolOverride?: pg.Pool): Promise<{
    id: string;
    companyId: string;
    email: string;
    roles: string[];
    permissions: string[];
  }> {
    return withTenant(
      { companyId: ctx.companyId, userId: ctx.userId },
      async (_tx, client) => {
        const res = await client.query<{ id: string; company_id: string; email: string }>(
          `SELECT id, company_id, email FROM users WHERE id = $1 AND deleted_at IS NULL`,
          [ctx.userId],
        );

        if (res.rows.length === 0) {
          throw new UnauthorizedError('User account not found.');
        }

        const authData = await getUserAuthorization(ctx.companyId, ctx.userId!, poolOverride);
        const u = res.rows[0]!;

        return {
          id: u.id,
          companyId: u.company_id,
          email: u.email,
          roles: authData.roles,
          permissions: authData.permissions,
        };
      },
      poolOverride,
    );
  }

  /**
   * Initiates password reset with no user enumeration.
   */
  async requestPasswordReset(
    email: string,
    ctx?: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<{ message: string }> {
    const db = poolOverride ?? getAppPool();
    const res = await db.query<UserLookupResult>(
      `SELECT id, company_id, email, status FROM lookup_user_by_email($1)`,
      [email.toLowerCase().trim()],
    );

    const user = res.rows[0];
    if (user && user.status === 'active') {
      const { rawToken, expiresAt } = await createAuthToken({
        companyId: user.company_id,
        userId: user.id,
        type: 'reset',
        ttlMinutes: 30,
        poolOverride,
      });

      // Insert transactional outbox event for sending reset email via worker
      await withTenant(
        { companyId: user.company_id, userId: user.id },
        async (_tx, client) => {
          await this.auditService.recordOutboxEvent(
            {
              companyId: user.company_id,
              userId: user.id,
              requestId: ctx?.requestId || 'req-pwd-reset',
              isAuthenticated: false,
            },
            'user',
            'email.password_reset',
            {
              userId: user.id,
              email: user.email,
              resetToken: rawToken,
              expiresAt: expiresAt.toISOString(),
            },
            client,
          );
        },
        poolOverride,
      );
    }

    return {
      message: 'If an account matches that email, password reset instructions have been dispatched.',
    };
  }

  /**
   * Completes password reset, validates policy, updates hash, revokes sessions.
   */
  async resetPassword(params: {
    token: string;
    newPassword: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
    requestId?: string | undefined;
    poolOverride?: pg.Pool | undefined;
  }): Promise<{ message: string }> {
    // 1. Validate password policy
    const policyResult = validatePasswordPolicy(params.newPassword);
    if (!policyResult.valid) {
      throw new ValidationError(
        'Password does not meet complexity requirements.',
        policyResult.errors,
      );
    }

    // 2. Consume single-use reset token
    const tokenRecord = await consumeAuthToken({
      rawToken: params.token,
      type: 'reset',
      poolOverride: params.poolOverride,
    });

    if (!tokenRecord) {
      throw new ValidationError('Password reset token is invalid or has expired.');
    }

    // 3. Hash new password
    const newHash = await hashPassword(params.newPassword);

    // 4. Update user password
    const db = params.poolOverride ?? getAppPool();
    await db.query(
      `SELECT reset_user_password_by_id($1, $2, $3)`,
      [tokenRecord.userId, tokenRecord.companyId, newHash],
    );

    // 5. Revoke all active sessions for this user
    await revokeAllUserSessions(
      tokenRecord.companyId,
      tokenRecord.userId,
      params.poolOverride,
    );

    // 6. Record audit log
    await this.auditService.recordEvent(
      {
        companyId: tokenRecord.companyId,
        userId: tokenRecord.userId,
        requestId: params.requestId || 'req-pwd-reset-success',
        ip: params.ip,
        userAgent: params.userAgent,
        isAuthenticated: true,
      },
      {
        action: 'auth.password.reset',
        entity: 'users',
        entityId: tokenRecord.userId,
        poolOverride: params.poolOverride,
      },
    );

    return {
      message: 'Your password has been reset successfully. Please log in with your new password.',
    };
  }
}
