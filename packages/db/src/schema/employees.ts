import { pgTable, uuid, text, bigint, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const counters = pgTable(
  'counters',
  {
    companyId: uuid('company_id').notNull(),
    key: text('key').notNull(),
    seq: bigint('seq', { mode: 'number' }).default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_counters_pk').on(table.companyId, table.key),
  ],
);

export const employees = pgTable(
  'employees',
  {
    ...baseTenantColumns,
    empCode: text('emp_code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: text('dob'),
    gender: text('gender'),
    maritalStatus: text('marital_status'),
    emailWork: text('email_work').notNull(),
    emailPersonal: text('email_personal'),
    phone: text('phone'),
    addresses: jsonb('addresses').$type<Record<string, unknown>>().default({}).notNull(),
    emergencyContacts: jsonb('emergency_contacts').$type<Array<Record<string, unknown>>>().default([]).notNull(),
    departmentId: uuid('department_id'),
    designationId: uuid('designation_id'),
    gradeId: uuid('grade_id'),
    costCenterId: uuid('cost_center_id'),
    locationId: uuid('location_id'),
    managerId: uuid('manager_id'),
    employmentType: text('employment_type', {
      enum: ['full_time', 'part_time', 'contract', 'intern'],
    }).default('full_time').notNull(),
    doj: text('doj').notNull(),
    confirmationDate: text('confirmation_date'),
    status: text('status', {
      enum: ['draft', 'active', 'probation', 'notice', 'terminated'],
    }).default('active').notNull(),
    jobEffectiveFrom: text('job_effective_from').notNull(),
    reportingPath: uuid('reporting_path').array().default([]).notNull(),
    bankEnc: text('bank_enc'),
    panEnc: text('pan_enc'),
    panBlindIdx: text('pan_blind_idx'),
    aadhaarEnc: text('aadhaar_enc'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().default({}).notNull(),
    userId: uuid('user_id'),
    searchKey: text('search_key').notNull(),
  },
  table => [
    uniqueIndex('idx_employees_company_emp_code').on(table.companyId, table.empCode),
    uniqueIndex('idx_employees_pan_blind_idx').on(table.companyId, table.panBlindIdx),
    index('idx_employees_company_status_dept').on(table.companyId, table.status, table.departmentId),
    index('idx_employees_company_manager').on(table.companyId, table.managerId),
    index('idx_employees_company_location').on(table.companyId, table.locationId),
    index('idx_employees_company_doj').on(table.companyId, table.doj),
    index('idx_employees_keyset').on(table.companyId, table.createdAt, table.id),
  ],
);

export const employeeHistory = pgTable(
  'employee_history',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    field: text('field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    effectiveFrom: text('effective_from').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
    changedBy: uuid('changed_by').notNull(),
    reason: text('reason'),
  },
  table => [
    index('idx_employee_history_timeline').on(table.companyId, table.employeeId, table.effectiveFrom),
    index('idx_employee_history_pending').on(table.effectiveFrom),
  ],
);

export type Counter = typeof counters.$inferSelect;
export type NewCounter = typeof counters.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type EmployeeHistory = typeof employeeHistory.$inferSelect;
export type NewEmployeeHistory = typeof employeeHistory.$inferInsert;
