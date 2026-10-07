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
import { baseTenantColumns } from '../columns.js';

export const legalEntities = pgTable(
  'legal_entities',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    pan: text('pan').notNull(),
    tan: text('tan').notNull(),
    pfEstablishmentId: text('pf_establishment_id'),
    esiCode: text('esi_code'),
    registrations: jsonb('registrations').$type<Record<string, unknown>>().default({}).notNull(),
    address: jsonb('address').$type<Record<string, unknown>>().default({}).notNull(),
    defaultBankAccountEnc: text('default_bank_account_enc'),
  },
  table => [
    uniqueIndex('idx_legal_entities_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_legal_entities_company_pan').on(table.companyId, table.pan),
  ],
);

export const payrollSettings = pgTable(
  'payroll_settings',
  {
    ...baseTenantColumns,
    legalEntityId: uuid('legal_entity_id').notNull(),
    payCycle: text('pay_cycle').$type<'monthly'>().default('monthly').notNull(),
    payDay: integer('pay_day').default(30).notNull(),
    paidDaysBasis: text('paid_days_basis')
      .$type<'calendar' | 'fixed_30' | 'working_days'>()
      .default('calendar')
      .notNull(),
    prorationMode: text('proration_mode')
      .$type<'prorate_earnings' | 'deduct_lop'>()
      .default('prorate_earnings')
      .notNull(),
    roundingDefaults: jsonb('rounding_defaults').$type<Record<string, unknown>>().default({}).notNull(),
    fyStartMonth: integer('fy_start_month').default(4).notNull(),
    labourCodeWages: jsonb('labour_code_wages')
      .$type<{ enabled: boolean; floorPct: number }>()
      .default({ enabled: false, floorPct: 50 })
      .notNull(),
    pfEnabled: boolean('pf_enabled').default(true).notNull(),
    esiEnabled: boolean('esi_enabled').default(true).notNull(),
    ptEnabled: boolean('pt_enabled').default(true).notNull(),
    lwfEnabled: boolean('lwf_enabled').default(true).notNull(),
    sod: jsonb('sod').$type<Record<string, unknown>>().default({ strict: true }).notNull(),
    negativeNetPolicy: text('negative_net_policy')
      .$type<'block' | 'hold' | 'carry_forward'>()
      .default('block')
      .notNull(),
    workingDaysSource: text('working_days_source').default('attendance_days').notNull(),
  },
  table => [
    uniqueIndex('idx_payroll_settings_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payroll_settings_company_entity').on(table.companyId, table.legalEntityId),
  ],
);

export const salaryComponents = pgTable(
  'salary_components',
  {
    ...baseTenantColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind')
      .$type<'earning' | 'deduction' | 'employer_contribution' | 'reimbursement' | 'benefit'>()
      .notNull(),
    calc: text('calc').$type<'fixed' | 'formula' | 'slab' | 'input'>().notNull(),
    formula: text('formula'),
    rounding: text('rounding').$type<'half_up' | 'floor' | 'ceil'>().default('half_up').notNull(),
    roundTarget: text('round_target').$type<'rupee' | 'paisa'>().default('rupee').notNull(),
    taxable: boolean('taxable').default(true).notNull(),
    taxExemptionRule: jsonb('tax_exemption_rule').$type<Record<string, unknown>>(),
    pfWage: boolean('pf_wage').default(false).notNull(),
    esiWage: boolean('esi_wage').default(false).notNull(),
    gratuityWage: boolean('gratuity_wage').default(false).notNull(),
    bonusWage: boolean('bonus_wage').default(false).notNull(),
    statutoryWage: boolean('statutory_wage').default(false).notNull(),
    prorate: boolean('prorate').default(true).notNull(),
    showOnPayslip: boolean('show_on_payslip').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    version: integer('version').default(1).notNull(),
    status: text('status').$type<'draft' | 'approved'>().default('draft').notNull(),
  },
  table => [
    uniqueIndex('idx_salary_components_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_salary_components_code_version').on(table.companyId, table.code, table.version),
    index('idx_salary_components_status').on(table.companyId, table.status),
  ],
);

export const salaryStructures = pgTable(
  'salary_structures',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    version: integer('version').default(1).notNull(),
    components: jsonb('components')
      .$type<
        Array<{
          code: string;
          calcOverride?: string;
          formula?: string;
          min?: number;
          max?: number;
          mandatory?: boolean;
          isBalancing?: boolean;
        }>
      >()
      .notNull(),
    validations: jsonb('validations').$type<Record<string, unknown>>().default({}).notNull(),
    status: text('status').$type<'draft' | 'approved' | 'retired'>().default('draft').notNull(),
  },
  table => [
    uniqueIndex('idx_salary_structures_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_salary_structures_name_version').on(table.companyId, table.name, table.version),
  ],
);

export const employeeSalary = pgTable(
  'employee_salary',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    structureId: uuid('structure_id').notNull(),
    structureVersion: integer('structure_version').notNull(),
    ctcAnnual: numeric('ctc_annual', { precision: 14, scale: 2 }).notNull(),
    overrides: jsonb('overrides').$type<Record<string, unknown>>().default({}).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    reason: text('reason')
      .$type<'join' | 'revision' | 'promotion' | 'correction'>()
      .default('join')
      .notNull(),
    status: text('status').$type<'draft' | 'approved' | 'rejected'>().default('draft').notNull(),
    makerId: uuid('maker_id').notNull(),
    checkerId: uuid('checker_id'),
  },
  table => [
    uniqueIndex('idx_employee_salary_company_id').on(table.companyId, table.id),
    index('idx_employee_salary_emp_effective').on(table.companyId, table.employeeId, table.effectiveFrom),
  ],
);

export const salaryRevisions = pgTable(
  'salary_revisions',
  {
    ...baseTenantColumns,
    batchId: text('batch_id').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    rows: jsonb('rows').$type<Array<Record<string, unknown>>>().notNull(),
    status: text('status')
      .$type<'draft' | 'previewed' | 'approved' | 'applied' | 'rejected'>()
      .default('draft')
      .notNull(),
    arrearsPolicy: jsonb('arrears_policy').$type<Record<string, unknown>>().default({}).notNull(),
  },
  table => [
    uniqueIndex('idx_salary_revisions_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_salary_revisions_batch').on(table.companyId, table.batchId),
  ],
);

export const statutoryRuleSets = pgTable(
  'statutory_rule_sets',
  {
    ...baseTenantColumns,
    key: text('key').notNull(),
    version: integer('version').default(1).notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status')
      .$type<'draft' | 'pending_approval' | 'active' | 'retired'>()
      .default('draft')
      .notNull(),
    makerId: uuid('maker_id').notNull(),
    checkerId: uuid('checker_id'),
    caVerifiedBy: text('ca_verified_by'),
    caVerifiedOn: timestamp('ca_verified_on', { withTimezone: true, mode: 'date' }),
    sourceNote: text('source_note'),
    testCases: jsonb('test_cases').$type<Array<Record<string, unknown>>>().default([]).notNull(),
  },
  table => [
    uniqueIndex('idx_statutory_rule_sets_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_statutory_rule_sets_key_ver').on(
      table.companyId,
      table.key,
      table.jurisdiction,
      table.version,
    ),
    index('idx_statutory_rule_sets_status').on(table.companyId, table.key, table.status),
  ],
);

export type LegalEntity = typeof legalEntities.$inferSelect;
export type NewLegalEntity = typeof legalEntities.$inferInsert;
export type PayrollSetting = typeof payrollSettings.$inferSelect;
export type NewPayrollSetting = typeof payrollSettings.$inferInsert;
export type SalaryComponent = typeof salaryComponents.$inferSelect;
export type NewSalaryComponent = typeof salaryComponents.$inferInsert;
export type SalaryStructure = typeof salaryStructures.$inferSelect;
export type NewSalaryStructure = typeof salaryStructures.$inferInsert;
export type EmployeeSalary = typeof employeeSalary.$inferSelect;
export type NewEmployeeSalary = typeof employeeSalary.$inferInsert;
export type SalaryRevision = typeof salaryRevisions.$inferSelect;
export type NewSalaryRevision = typeof salaryRevisions.$inferInsert;
export type StatutoryRuleSet = typeof statutoryRuleSets.$inferSelect;
export type NewStatutoryRuleSet = typeof statutoryRuleSets.$inferInsert;

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    ...baseTenantColumns,
    legalEntityId: uuid('legal_entity_id').notNull(),
    period: text('period').notNull(), // 'YYYY-MM'
    fy: text('fy').notNull(), // 'YYYY-YYYY'
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    cutoffDate: date('cutoff_date').notNull(),
    payDate: date('pay_date').notNull(),
    status: text('status').$type<'open' | 'locked'>().default('open').notNull(),
  },
  table => [
    uniqueIndex('idx_payroll_periods_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payroll_periods_company_entity_period').on(
      table.companyId,
      table.legalEntityId,
      table.period,
    ),
  ],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    ...baseTenantColumns,
    periodId: uuid('period_id').notNull(),
    runType: text('run_type')
      .$type<'regular' | 'off_cycle' | 'correction' | 'final'>()
      .default('regular')
      .notNull(),
    sequence: integer('sequence').default(1).notNull(),
    status: text('status')
      .$type<
        | 'draft'
        | 'inputs_ready'
        | 'calculating'
        | 'calculated'
        | 'review'
        | 'approved'
        | 'locking'
        | 'locked'
        | 'published'
        | 'paid'
        | 'cancelled'
      >()
      .default('draft')
      .notNull(),
    calcVersion: integer('calc_version').default(1).notNull(),
    ruleVersions: jsonb('rule_versions').$type<Record<string, string>>().default({}).notNull(),
    settingsSnapshot: jsonb('settings_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    engineVersion: text('engine_version').default('1.0.0').notNull(),
    counts: jsonb('counts')
      .$type<{ total: number; included: number; held: number; excluded: number; errors: number }>()
      .default({ total: 0, included: 0, held: 0, excluded: 0, errors: 0 })
      .notNull(),
    totals: jsonb('totals')
      .$type<{ gross: string; deductions: string; employerCost: string; net: string }>()
      .default({ gross: '0.00', deductions: '0.00', employerCost: '0.00', net: '0.00' })
      .notNull(),
    approvedBy: uuid('approved_by'),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    runHash: text('run_hash'),
    notes: text('notes'),
  },
  table => [
    uniqueIndex('idx_payroll_runs_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payroll_runs_unique_seq').on(
      table.companyId,
      table.periodId,
      table.runType,
      table.sequence,
    ),
    index('idx_payroll_runs_status').on(table.companyId, table.status),
  ],
);

export const payrollInputs = pgTable(
  'payroll_inputs',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    type: text('type')
      .$type<
        | 'bonus'
        | 'incentive'
        | 'arrear'
        | 'deduction'
        | 'loan_emi'
        | 'reimbursement'
        | 'adjustment'
        | 'lop_override'
        | 'leave_encashment'
        | 'other'
      >()
      .notNull(),
    componentCode: text('component_code'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    taxable: boolean('taxable').default(true).notNull(),
    forPeriod: text('for_period').notNull(), // 'YYYY-MM'
    sourceType: text('source_type'), // e.g. 'salary_revision', 'loan_installment', 'manual'
    sourceId: text('source_id'),
    status: text('status')
      .$type<'pending' | 'approved' | 'consumed' | 'cancelled'>()
      .default('pending')
      .notNull(),
    approvedBy: uuid('approved_by'),
    consumedRunId: uuid('consumed_run_id'),
    note: text('note'),
  },
  table => [
    uniqueIndex('idx_payroll_inputs_company_id').on(table.companyId, table.id),
    index('idx_payroll_inputs_status_period').on(table.companyId, table.status, table.forPeriod),
    index('idx_payroll_inputs_emp_period').on(table.companyId, table.employeeId, table.forPeriod),
  ],
);

export const payrollEmployeeRuns = pgTable(
  'payroll_employee_runs',
  {
    ...baseTenantColumns,
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    status: text('status')
      .$type<'included' | 'held' | 'excluded' | 'error'>()
      .default('included')
      .notNull(),
    holdReason: text('hold_reason'),
    warnings: jsonb('warnings').$type<string[]>().default([]).notNull(),
    blockers: jsonb('blockers').$type<string[]>().default([]).notNull(),
    inputHash: text('input_hash'),
    calcVersion: integer('calc_version').default(1).notNull(),
    gross: numeric('gross', { precision: 14, scale: 2 }).default('0.00').notNull(),
    deductions: numeric('deductions', { precision: 14, scale: 2 }).default('0.00').notNull(),
    employerCost: numeric('employer_cost', { precision: 14, scale: 2 }).default('0.00').notNull(),
    net: numeric('net', { precision: 14, scale: 2 }).default('0.00').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().default({}).notNull(),
  },
  table => [
    uniqueIndex('idx_payroll_employee_runs_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payroll_employee_runs_run_emp').on(table.companyId, table.runId, table.employeeId),
    index('idx_payroll_employee_runs_status').on(table.companyId, table.runId, table.status),
  ],
);

export const payrollRunEvents = pgTable(
  'payroll_run_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    runId: uuid('run_id').notNull(),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    actorId: uuid('actor_id').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    event: text('event').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
  },
  table => [
    uniqueIndex('idx_payroll_run_events_company_id').on(table.companyId, table.id),
    index('idx_payroll_run_events_run_ts').on(table.companyId, table.runId, table.ts),
  ],
);

export const employeeLoans = pgTable(
  'employee_loans',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    type: text('type').$type<'loan' | 'advance'>().default('loan').notNull(),
    principal: numeric('principal', { precision: 14, scale: 2 }).notNull(),
    interestRate: numeric('interest_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
    installmentsCount: integer('installments_count').notNull(),
    emiAmount: numeric('emi_amount', { precision: 14, scale: 2 }).notNull(),
    startPeriod: text('start_period').notNull(), // 'YYYY-MM'
    status: text('status')
      .$type<'active' | 'completed' | 'paused' | 'cancelled'>()
      .default('active')
      .notNull(),
  },
  table => [
    uniqueIndex('idx_employee_loans_company_id').on(table.companyId, table.id),
    index('idx_employee_loans_emp_status').on(table.companyId, table.employeeId, table.status),
  ],
);

export const loanInstallments = pgTable(
  'loan_installments',
  {
    ...baseTenantColumns,
    loanId: uuid('loan_id').notNull(),
    installmentNumber: integer('installment_number').notNull(),
    duePeriod: text('due_period').notNull(), // 'YYYY-MM'
    principalComponent: numeric('principal_component', { precision: 14, scale: 2 }).notNull(),
    interestComponent: numeric('interest_component', { precision: 14, scale: 2 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').$type<'due' | 'recovered' | 'skipped'>().default('due').notNull(),
    recoveredRunId: uuid('recovered_run_id'),
    recoveredAt: timestamp('recovered_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_loan_installments_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_loan_installments_loan_inst').on(
      table.companyId,
      table.loanId,
      table.installmentNumber,
    ),
    index('idx_loan_installments_due_period').on(table.companyId, table.duePeriod, table.status),
  ],
);

export const payslips = pgTable(
  'payslips',
  {
    ...baseTenantColumns,
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    period: text('period').notNull(),
    gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
    deductions: numeric('deductions', { precision: 14, scale: 2 }).notNull(),
    employerCost: numeric('employer_cost', { precision: 14, scale: 2 }).notNull(),
    net: numeric('net', { precision: 14, scale: 2 }).notNull(),
    integrityHash: text('integrity_hash').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    pdfFileId: uuid('pdf_file_id'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    paymentStatus: text('payment_status')
      .$type<'pending' | 'paid' | 'failed' | 'returned'>()
      .default('pending')
      .notNull(),
    paymentRef: text('payment_ref'),
  },
  table => [
    uniqueIndex('idx_payslips_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payslips_run_emp').on(table.companyId, table.runId, table.employeeId),
    index('idx_payslips_emp_period').on(table.companyId, table.employeeId, table.period),
    index('idx_payslips_run').on(table.companyId, table.runId),
  ],
);

export const payslipLines = pgTable(
  'payslip_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    payslipId: uuid('payslip_id').notNull(),
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    componentCode: text('component_code').notNull(),
    kind: text('kind')
      .$type<'earning' | 'deduction' | 'employer_contribution' | 'reimbursement'>()
      .notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    taxableAmount: numeric('taxable_amount', { precision: 14, scale: 2 }).default('0.00').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ruleRef: text('rule_ref'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdBy: uuid('created_by'),
  },
  table => [
    uniqueIndex('idx_payslip_lines_company_id').on(table.companyId, table.id),
    index('idx_payslip_lines_run_comp').on(table.companyId, table.runId, table.componentCode),
    index('idx_payslip_lines_emp_run').on(table.companyId, table.employeeId, table.runId),
    index('idx_payslip_lines_payslip').on(table.companyId, table.payslipId),
  ],
);

export const payrollYtd = pgTable(
  'payroll_ytd',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    fy: text('fy').notNull(),
    componentCode: text('component_code').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    lastRunId: uuid('last_run_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_payroll_ytd_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_payroll_ytd_emp_fy_comp').on(
      table.companyId,
      table.employeeId,
      table.fy,
      table.componentCode,
    ),
  ],
);

export const tdsComputations = pgTable(
  'tds_computations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    regime: text('regime').$type<'new' | 'old'>().notNull(),
    annualProjection: jsonb('annual_projection').$type<Record<string, unknown>>().notNull(),
    tdsThisMonth: numeric('tds_this_month', { precision: 14, scale: 2 }).notNull(),
    tdsYtd: numeric('tds_ytd', { precision: 14, scale: 2 }).notNull(),
    remainingMonths: integer('remaining_months').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_tds_computations_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_tds_computations_run_emp').on(table.companyId, table.runId, table.employeeId),
  ],
);

export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type NewPayrollPeriod = typeof payrollPeriods.$inferInsert;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;
export type PayrollInput = typeof payrollInputs.$inferSelect;
export type NewPayrollInput = typeof payrollInputs.$inferInsert;
export type PayrollEmployeeRun = typeof payrollEmployeeRuns.$inferSelect;
export type NewPayrollEmployeeRun = typeof payrollEmployeeRuns.$inferInsert;
export type PayrollRunEvent = typeof payrollRunEvents.$inferSelect;
export type NewPayrollRunEvent = typeof payrollRunEvents.$inferInsert;
export type EmployeeLoan = typeof employeeLoans.$inferSelect;
export type NewEmployeeLoan = typeof employeeLoans.$inferInsert;
export type LoanInstallment = typeof loanInstallments.$inferSelect;
export type NewLoanInstallment = typeof loanInstallments.$inferInsert;
export type Payslip = typeof payslips.$inferSelect;
export type NewPayslip = typeof payslips.$inferInsert;
export type PayslipLine = typeof payslipLines.$inferSelect;
export type NewPayslipLine = typeof payslipLines.$inferInsert;
export type PayrollYtd = typeof payrollYtd.$inferSelect;
export type NewPayrollYtd = typeof payrollYtd.$inferInsert;
export type TdsComputation = typeof tdsComputations.$inferSelect;
export type NewTdsComputation = typeof tdsComputations.$inferInsert;

