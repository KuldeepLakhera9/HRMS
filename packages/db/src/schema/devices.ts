import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const employeeDevices = pgTable(
  'employee_devices',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    deviceId: text('device_id').notNull(),
    deviceModel: text('device_model').notNull(),
    osName: text('os_name').notNull(),
    osVersion: text('os_version').notNull(),
    appVersion: text('app_version').notNull(),
    status: text('status')
      .$type<'active' | 'pending_approval' | 'revoked'>()
      .default('active')
      .notNull(),
    lastAttestedAt: timestamp('last_attested_at', { withTimezone: true, mode: 'date' }),
    attestationPayload: jsonb('attestation_payload').default({}).notNull(),
  },
  table => [
    uniqueIndex('idx_employee_devices_company_id').on(table.companyId, table.id),
    index('idx_employee_devices_lookup').on(table.companyId, table.employeeId, table.deviceId),
  ],
);

export type EmployeeDevice = typeof employeeDevices.$inferSelect;
export type NewEmployeeDevice = typeof employeeDevices.$inferInsert;
