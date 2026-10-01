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
  revokeAllUserSessions,
  type SessionData,
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

    // 4. Check account status
    if (user.status !== 'active') {
      throw new ForbiddenError(`Account is ${user.status}. Please contact an administrator.`);
    }

    // 5. Verify password
    const isPasswordValid = await verifyPassword(params.password, user.password_hash);
    if (!isPasswordValid) {
      const lockRes = await recordFailedLogin(user.company_id, user.id, params.poolOverride);

      await this.auditService.recordEvent(
        {
          companyId: user.company_id,
          userId: user.id,
          requestId: params.requestId || 'req-login-failed',
          ip: params.ip,
          userAgent: params.userAgent,
          isAuthenticated: false,
        },
        {
          action: 'auth.login.failed',
          entity: 'users',
          entityId: user.id,
          meta: { reason: 'invalid_password', isLocked: lockRes.isLocked },
          poolOverride: params.poolOverride,
        },
      );

      throw new UnauthorizedError('Invalid email or password.');
    }

    // 6. Check MFA requirement
    if (user.mfa_enabled) {
      if (!params.mfaCode) {
        return {
          mfaRequired: true,
          tempUserId: user.id,
          tempCompanyId: user.company_id,
        };
      }

      // Verify MFA code
      if (!user.mfa_secret_enc) {
        throw new UnauthorizedError('MFA configuration error.');
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
    const { rawToken, sessionId, sessionData } = await createSession({
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
