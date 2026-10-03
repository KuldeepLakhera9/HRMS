import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const attendancePolicies = pgTable(
  'attendance_policies',
  {
    ...baseTenantColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    geofenceMode: text('geofence_mode').$type<'strict' | 'soft' | 'off'>().default('strict').notNull(),
    allowSelfie: boolean('allow_selfie').default(false).notNull(),
    requireSelfie: boolean('require_selfie').default(false).notNull(),
    maxGpsAccuracyMeters: integer('max_gps_accuracy_meters').default(50).notNull(),
    allowedSources: text('allowed_sources').array().default(['mobile', 'web']).notNull(),
    graceMinutes: integer('grace_minutes').default(15).notNull(),
    halfDayMinutes: integer('half_day_minutes').default(240).notNull(),
    fullDayMinutes: integer('full_day_minutes').default(480).notNull(),
    autoPunchOutHours: numeric('auto_punch_out_hours', { precision: 4, scale: 1 }).default('12.0').notNull(),
    version: integer('version').default(1).notNull(),
  },
  table => [
    uniqueIndex('idx_attendance_policies_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_attendance_policies_code').on(table.companyId, table.code),
  ],
);

export const attendancePolicyAssignments = pgTable(
  'attendance_policy_assignments',
  {
    ...baseTenantColumns,
    policyId: uuid('policy_id').notNull(),
    priority: integer('priority').notNull(), // 1=employee, 2=department, 3=location, 4=company
    targetType: text('target_type')
      .$type<'employee' | 'department' | 'location' | 'company'>()
      .notNull(),
    targetId: uuid('target_id'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  table => [
    uniqueIndex('idx_att_policy_assign_company_id').on(table.companyId, table.id),
    index('idx_att_policy_assignments_lookup').on(
      table.companyId,
      table.targetType,
      table.targetId,
      table.priority,
    ),
  ],
);

export type AttendancePolicy = typeof attendancePolicies.$inferSelect;
export type NewAttendancePolicy = typeof attendancePolicies.$inferInsert;
export type AttendancePolicyAssignment = typeof attendancePolicyAssignments.$inferSelect;
export type NewAttendancePolicyAssignment = typeof attendancePolicyAssignments.$inferInsert;
