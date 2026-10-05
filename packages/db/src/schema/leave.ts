import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { baseTenantColumns } from '../columns.js';
import { generateUuidV7 } from '../id.js';

export const leaveTypes = pgTable(
  'leave_types',
  {
    ...baseTenantColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    isPaid: boolean('is_paid').default(true).notNull(),
    unit: text('unit').$type<'day' | 'hour'>().default('day').notNull(),
    allowHalfDay: boolean('allow_half_day').default(true).notNull(),
    allowHourly: boolean('allow_hourly').default(false).notNull(),
    requiresDocumentAfterDays: integer('requires_document_after_days'),
    maxConsecutiveDays: integer('max_consecutive_days'),
    minNoticeDays: integer('min_notice_days').default(0).notNull(),
    sandwichRule: text('sandwich_rule')
      .$type<'none' | 'holidays' | 'weekly_offs' | 'both'>()
      .default('none')
      .notNull(),
    allowNegativeBalance: boolean('allow_negative_balance').default(false).notNull(),
    negativeLimit: numeric('negative_limit', { precision: 7, scale: 3 }).default('0.000').notNull(),
    applicableTo: jsonb('applicable_to')
      .$type<{
        gender?: string[];
        employmentType?: string[];
        minTenureDays?: number;
        locations?: string[];
        departments?: string[];
      }>()
      .default({})
      .notNull(),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_leave_types_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_leave_types_code').on(table.companyId, table.code),
    index('idx_leave_types_active').on(table.companyId, table.active),
  ],
);

export const leavePolicies = pgTable(
  'leave_policies',
  {
    ...baseTenantColumns,
    leaveTypeId: uuid('leave_type_id').notNull(),
    version: integer('version').default(1).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    periodBasis: text('period_basis')
      .$type<'calendar' | 'fiscal' | 'anniversary'>()
      .default('calendar')
      .notNull(),
    accrual: jsonb('accrual')
      .$type<{
        frequency: 'monthly' | 'quarterly' | 'yearly' | 'on_joining';
        amount: number;
        proRata?: boolean;
        rounding?: number;
      }>()
      .default({ frequency: 'monthly', amount: 1.5, proRata: true, rounding: 0.5 })
      .notNull(),
    carryForward: jsonb('carry_forward')
      .$type<{
        enabled: boolean;
        maxDays?: number;
        expiryDays?: number;
      }>()
      .default({ enabled: false })
      .notNull(),
    maxBalance: numeric('max_balance', { precision: 7, scale: 3 }),
    probationRule: jsonb('probation_rule')
      .$type<{
        allowDuringProbation?: boolean;
        accrueDuringProbation?: boolean;
      }>()
      .default({ allowDuringProbation: true, accrueDuringProbation: true })
      .notNull(),
    compOff: jsonb('comp_off')
      .$type<{
        enabled?: boolean;
        validityDays?: number;
        mode?: 'auto' | 'claim';
        halfDayMinutes?: number;
        fullDayMinutes?: number;
      }>(),
  },
  table => [
    uniqueIndex('idx_leave_policies_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_leave_policies_version').on(table.companyId, table.leaveTypeId, table.version),
    index('idx_leave_policies_lookup').on(table.companyId, table.leaveTypeId, table.effectiveFrom),
  ],
);

export const leavePolicyAssignments = pgTable(
  'leave_policy_assignments',
  {
    ...baseTenantColumns,
    scopeType: text('scope_type')
      .$type<'company' | 'department' | 'location' | 'employment_type' | 'employee'>()
      .notNull(),
    scopeId: uuid('scope_id'),
    leaveTypeId: uuid('leave_type_id').notNull(),
    policyId: uuid('policy_id').notNull(),
  },
  table => [
    uniqueIndex('idx_leave_policy_assignments_company_id').on(table.companyId, table.id),
    index('idx_leave_policy_assignments_lookup').on(
      table.companyId,
      table.leaveTypeId,
      table.scopeType,
      table.scopeId,
    ),
  ],
);

export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),
    companyId: uuid('company_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    periodKey: text('period_key').notNull(),
    entryType: text('entry_type')
      .$type<
        | 'opening'
        | 'accrual'
        | 'carry_forward'
        | 'expiry'
        | 'usage'
        | 'reversal'
        | 'adjustment'
        | 'encashment'
      >()
      .notNull(),
    deltaDays: numeric('delta_days', { precision: 7, scale: 3 }).notNull(),
    effectiveDate: date('effective_date').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    reason: text('reason'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}).notNull(),
    dedupeKey: text('dedupe_key'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex('idx_leave_ledger_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_leave_ledger_dedupe')
      .on(table.companyId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    index('idx_leave_ledger_employee_balance').on(
      table.companyId,
      table.employeeId,
      table.leaveTypeId,
      table.periodKey,
      table.effectiveDate,
    ),
  ],
);

export const leaveBalances = pgTable(
  'leave_balances',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    periodKey: text('period_key').notNull(),
    opening: numeric('opening', { precision: 7, scale: 3 }).default('0.000').notNull(),
    accrued: numeric('accrued', { precision: 7, scale: 3 }).default('0.000').notNull(),
    used: numeric('used', { precision: 7, scale: 3 }).default('0.000').notNull(),
    adjusted: numeric('adjusted', { precision: 7, scale: 3 }).default('0.000').notNull(),
    expired: numeric('expired', { precision: 7, scale: 3 }).default('0.000').notNull(),
    encashed: numeric('encashed', { precision: 7, scale: 3 }).default('0.000').notNull(),
    pending: numeric('pending', { precision: 7, scale: 3 }).default('0.000').notNull(),
    closing: numeric('closing', { precision: 7, scale: 3 }).default('0.000').notNull(),
  },
  table => [
    uniqueIndex('idx_leave_balances_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_leave_balances_emp_type_period').on(
      table.companyId,
      table.employeeId,
      table.leaveTypeId,
      table.periodKey,
    ),
    index('idx_leave_balances_emp').on(table.companyId, table.employeeId),
  ],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    fromPart: text('from_part').$type<'full' | 'first' | 'second'>().default('full').notNull(),
    toPart: text('to_part').$type<'full' | 'first' | 'second'>().default('full').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }),
    days: numeric('days', { precision: 7, scale: 3 }).notNull(),
    reason: text('reason').notNull(),
    documentFileId: uuid('document_file_id'),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn'>()
      .default('pending')
      .notNull(),
    workflowRequestId: uuid('workflow_request_id'),
    policyVersion: integer('policy_version').default(1).notNull(),
    ruleVersion: integer('rule_version').default(1).notNull(),
  },
  table => [
    uniqueIndex('idx_leave_requests_company_id').on(table.companyId, table.id),
    index('idx_leave_requests_emp_from').on(table.companyId, table.employeeId, table.fromDate),
    index('idx_leave_requests_status').on(table.companyId, table.status, table.createdAt),
  ],
);

export const leaveRequestDays = pgTable(
  'leave_request_days',
  {
    ...baseTenantColumns,
    requestId: uuid('request_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    leaveDate: date('leave_date').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true, mode: 'date' }).notNull(),
    part: text('part').$type<'full' | 'first' | 'second' | 'hours'>().default('full').notNull(),
    days: numeric('days', { precision: 7, scale: 3 }).notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn'>()
      .default('pending')
      .notNull(),
    isPaid: boolean('is_paid').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_leave_request_days_company_id').on(table.companyId, table.id),
    index('idx_leave_request_days_date_emp').on(table.companyId, table.leaveDate, table.employeeId),
    index('idx_leave_request_days_req').on(table.companyId, table.requestId),
  ],
);

export const compOffCredits = pgTable(
  'comp_off_credits',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    sourceDate: date('source_date').notNull(),
    sourceType: text('source_type')
      .$type<'weekly_off' | 'holiday' | 'overtime'>()
      .notNull(),
    minutesWorked: integer('minutes_worked').notNull(),
    daysGranted: numeric('days_granted', { precision: 4, scale: 2 }).notNull(),
    expiresOn: date('expires_on').notNull(),
    status: text('status')
      .$type<'granted' | 'used' | 'expired' | 'claimed'>()
      .default('granted')
      .notNull(),
    ledgerRef: uuid('ledger_ref'),
  },
  table => [
    uniqueIndex('idx_comp_off_credits_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_comp_off_credits_unique').on(
      table.companyId,
      table.employeeId,
      table.sourceDate,
      table.sourceType,
    ),
    index('idx_comp_off_credits_emp_status').on(table.companyId, table.employeeId, table.status),
  ],
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;
export type LeavePolicy = typeof leavePolicies.$inferSelect;
export type NewLeavePolicy = typeof leavePolicies.$inferInsert;
export type LeavePolicyAssignment = typeof leavePolicyAssignments.$inferSelect;
export type NewLeavePolicyAssignment = typeof leavePolicyAssignments.$inferInsert;
export type LeaveLedgerEntry = typeof leaveLedger.$inferSelect;
export type NewLeaveLedgerEntry = typeof leaveLedger.$inferInsert;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type NewLeaveBalance = typeof leaveBalances.$inferInsert;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
export type LeaveRequestDay = typeof leaveRequestDays.$inferSelect;
export type NewLeaveRequestDay = typeof leaveRequestDays.$inferInsert;
export type CompOffCredit = typeof compOffCredits.$inferSelect;
export type NewCompOffCredit = typeof compOffCredits.$inferInsert;

