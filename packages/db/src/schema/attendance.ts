import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  time,
  timestamp,
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

export const shifts = pgTable(
  'shifts',
  {
    ...baseTenantColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    crossesMidnight: boolean('crosses_midnight').default(false).notNull(),
    graceMinutes: integer('grace_minutes').default(15).notNull(),
    breakMinutes: integer('break_minutes').default(60).notNull(),
    workHours: numeric('work_hours', { precision: 4, scale: 2 }).default('8.00').notNull(),
  },
  table => [
    uniqueIndex('idx_shifts_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_shifts_code').on(table.companyId, table.code),
  ],
);

export const rosters = pgTable(
  'rosters',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    workDate: date('work_date').notNull(),
    isWeeklyOff: boolean('is_weekly_off').default(false).notNull(),
    isHoliday: boolean('is_holiday').default(false).notNull(),
    status: text('status').$type<'draft' | 'published'>().default('published').notNull(),
  },
  table => [
    uniqueIndex('idx_rosters_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_rosters_employee_date').on(table.companyId, table.employeeId, table.workDate),
    index('idx_rosters_lookup').on(table.companyId, table.employeeId, table.workDate),
  ],
);

export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: uuid('id').notNull(),
    companyId: uuid('company_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    punchTime: timestamp('punch_time', { withTimezone: true, mode: 'date' }).notNull(),
    punchType: text('punch_type').$type<'in' | 'out' | 'auto_out'>().notNull(),
    source: text('source').$type<'mobile' | 'web' | 'biometric' | 'qr'>().notNull(),
    workDate: date('work_date').notNull(),
    shiftId: uuid('shift_id'),
    locationId: uuid('location_id'),
    gpsAccuracy: numeric('gps_accuracy', { precision: 6, scale: 2 }),
    isInsideGeofence: boolean('is_inside_geofence').default(true).notNull(),
    distanceMeters: numeric('distance_meters', { precision: 8, scale: 2 }),
    selfieFileId: uuid('selfie_file_id'),
    deviceId: text('device_id'),
    deviceModel: text('device_model'),
    isMockLocation: boolean('is_mock_location').default(false).notNull(),
    status: text('status').$type<'valid' | 'flagged' | 'soft_pending' | 'rejected'>().default('valid').notNull(),
    reasonCode: text('reason_code').default('PUNCH_SUCCESS').notNull(),
    flagReasons: text('flag_reasons').array().default([]).notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_attendance_punches_pk').on(table.companyId, table.id, table.punchTime),
    index('idx_attendance_punches_emp').on(table.companyId, table.employeeId, table.punchTime),
    index('idx_attendance_punches_work_date').on(table.companyId, table.workDate),
  ],
);

export const attendancePunchReviews = pgTable(
  'attendance_punch_reviews',
  {
    ...baseTenantColumns,
    punchId: uuid('punch_id').notNull(),
    punchTime: timestamp('punch_time', { withTimezone: true, mode: 'date' }).notNull(),
    workflowRequestId: uuid('workflow_request_id').notNull(),
    status: text('status').$type<'pending' | 'approved' | 'rejected'>().default('pending').notNull(),
    reviewerId: uuid('reviewer_id'),
    reviewComments: text('review_comments'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_attendance_punch_reviews_company_id').on(table.companyId, table.id),
    index('idx_punch_reviews_lookup').on(table.companyId, table.punchId, table.status),
    index('idx_punch_reviews_wf').on(table.companyId, table.workflowRequestId),
  ],
);

export const attendancePresence = pgTable(
  'attendance_presence',
  {
    id: uuid('id').notNull(),
    companyId: uuid('company_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    status: text('status').$type<'in' | 'out'>().notNull(),
    lastPunchId: uuid('last_punch_id').notNull(),
    lastPunchTime: timestamp('last_punch_time', { withTimezone: true, mode: 'date' }).notNull(),
    locationId: uuid('location_id'),
    shiftDate: date('shift_date').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_attendance_presence_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_attendance_presence_employee').on(table.companyId, table.employeeId),
    index('idx_attendance_presence_status').on(table.companyId, table.status, table.shiftDate),
  ],
);

export const attendanceDays = pgTable(
  'attendance_days',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    shiftId: uuid('shift_id'),
    firstIn: timestamp('first_in', { withTimezone: true, mode: 'date' }),
    lastOut: timestamp('last_out', { withTimezone: true, mode: 'date' }),
    punchCount: integer('punch_count').default(0).notNull(),
    totalWorkMinutes: integer('total_work_minutes').default(0).notNull(),
    effectiveMinutes: integer('effective_minutes').default(0).notNull(),
    lateInMinutes: integer('late_in_minutes').default(0).notNull(),
    earlyOutMinutes: integer('early_out_minutes').default(0).notNull(),
    overtimeMinutes: integer('overtime_minutes').default(0).notNull(),
    status: text('status')
      .$type<'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekly_off' | 'missing_punch'>()
      .default('absent')
      .notNull(),
    isRegularized: boolean('is_regularized').default(false).notNull(),
    isLocked: boolean('is_locked').default(false).notNull(),
    ruleVersion: integer('rule_version').default(1).notNull(),
    sourceHash: text('source_hash'),
  },
  table => [
    uniqueIndex('idx_attendance_days_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_attendance_days_emp_date').on(table.companyId, table.employeeId, table.workDate),
    index('idx_attendance_days_company_date').on(table.companyId, table.workDate, table.status),
  ],
);

export const attendancePeriodLocks = pgTable(
  'attendance_period_locks',
  {
    ...baseTenantColumns,
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    isLocked: boolean('is_locked').default(true).notNull(),
    lockedBy: uuid('locked_by').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    unlockedBy: uuid('unlocked_by'),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true, mode: 'date' }),
    reason: text('reason').notNull(),
  },
  table => [
    uniqueIndex('idx_attendance_period_locks_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_attendance_period_locks_period').on(table.companyId, table.periodStart, table.periodEnd),
  ],
);

export type AttendancePolicy = typeof attendancePolicies.$inferSelect;
export type NewAttendancePolicy = typeof attendancePolicies.$inferInsert;
export type AttendancePolicyAssignment = typeof attendancePolicyAssignments.$inferSelect;
export type NewAttendancePolicyAssignment = typeof attendancePolicyAssignments.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type Roster = typeof rosters.$inferSelect;
export type NewRoster = typeof rosters.$inferInsert;
export type AttendancePunch = typeof attendancePunches.$inferSelect;
export type NewAttendancePunch = typeof attendancePunches.$inferInsert;
export type AttendancePunchReview = typeof attendancePunchReviews.$inferSelect;
export type NewAttendancePunchReview = typeof attendancePunchReviews.$inferInsert;
export type AttendancePresence = typeof attendancePresence.$inferSelect;
export type NewAttendancePresence = typeof attendancePresence.$inferInsert;
export type AttendanceDay = typeof attendanceDays.$inferSelect;
export type NewAttendanceDay = typeof attendanceDays.$inferInsert;
export type AttendancePeriodLock = typeof attendancePeriodLocks.$inferSelect;
export type NewAttendancePeriodLock = typeof attendancePeriodLocks.$inferInsert;
