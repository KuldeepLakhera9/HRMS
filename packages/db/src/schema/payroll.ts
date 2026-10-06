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
