import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const biometricDevices = pgTable(
  'biometric_devices',
  {
    ...baseTenantColumns,
    deviceId: text('device_id').notNull(),
    name: text('name').notNull(),
    ipCidr: text('ip_cidr').notNull(),
    hmacSecret: text('hmac_secret').notNull(),
    locationId: uuid('location_id').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_biometric_devices_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_biometric_devices_code').on(table.companyId, table.deviceId),
  ],
);

export const biometricQuarantine = pgTable(
  'biometric_quarantine',
  {
    ...baseTenantColumns,
    deviceId: text('device_id').notNull(),
    biometricUserId: text('biometric_user_id').notNull(),
    punchTime: timestamp('punch_time', { withTimezone: true, mode: 'date' }).notNull(),
    punchType: text('punch_type').$type<'in' | 'out' | 'auto'>().notNull(),
    rawPayload: jsonb('raw_payload').default({}).notNull(),
    errorReason: text('error_reason').notNull(),
    resolved: boolean('resolved').default(false).notNull(),
    resolvedEmployeeId: uuid('resolved_employee_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_biometric_quarantine_company_id').on(table.companyId, table.id),
    index('idx_biometric_quarantine_lookup').on(table.companyId, table.resolved, table.createdAt),
  ],
);

export type BiometricDevice = typeof biometricDevices.$inferSelect;
export type NewBiometricDevice = typeof biometricDevices.$inferInsert;
export type BiometricQuarantine = typeof biometricQuarantine.$inferSelect;
export type NewBiometricQuarantine = typeof biometricQuarantine.$inferInsert;
