import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const sessions = pgTable(
  'sessions',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    refreshHash: text('refresh_hash').unique(),
    familyId: uuid('family_id').notNull(),
    clientType: text('client_type', { enum: ['web', 'mobile', 'api'] })
      .default('web')
      .notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    deviceLabel: text('device_label'),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true, mode: 'date' }),
    stepUpUntil: timestamp('step_up_until', { withTimezone: true, mode: 'date' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    index('idx_sessions_user_active').on(table.companyId, table.userId),
    index('idx_sessions_absolute_expiry').on(table.absoluteExpiresAt),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    type: text('type', { enum: ['invite', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    index('idx_auth_tokens_lookup').on(table.tokenHash, table.type),
  ],
);

export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    index('idx_mfa_recovery_lookup').on(table.companyId, table.userId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;
export type MfaRecoveryCode = typeof mfaRecoveryCodes.$inferSelect;
export type NewMfaRecoveryCode = typeof mfaRecoveryCodes.$inferInsert;
