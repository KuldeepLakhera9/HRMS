import { pgTable, uuid, text, boolean, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const users = pgTable(
  'users',
  {
    ...baseTenantColumns,
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: ['invited', 'active', 'locked', 'disabled'] })
      .default('invited')
      .notNull(),
    mfaEnabled: boolean('mfa_enabled').default(false).notNull(),
    mfaSecretEnc: text('mfa_secret_enc'),
    failedAttempts: integer('failed_attempts').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    permVersion: integer('perm_version').default(1).notNull(),
    employeeId: uuid('employee_id'),
  },
  table => [
    uniqueIndex('idx_users_company_email').on(table.companyId, table.email),
    index('idx_users_company_status').on(table.companyId, table.status),
    index('idx_users_locked_until').on(table.lockedUntil),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
